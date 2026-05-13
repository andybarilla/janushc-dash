package main

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/andybarilla/janushc-dash/internal/transcribe"
	"github.com/joho/godotenv"
)

type options struct {
	input        string
	outDir       string
	bucket       string
	prefix       string
	region       string
	timeout      time.Duration
	pollInterval time.Duration
	expireDays   int
	maxSpeakers  int
	overwrite    bool
	dryRun       bool
	ensureBucket bool
	deleteAudio  bool
	keepJSON     bool
}

func main() {
	var opts options
	flag.StringVar(&opts.input, "input", defaultInputDir(), "audio file or directory to transcribe")
	flag.StringVar(&opts.outDir, "out", "tmp/transcripts", "directory for transcript .txt files")
	flag.StringVar(&opts.bucket, "bucket", "", "S3 bucket for batch media and transcript JSON (defaults to AWS_TRANSCRIBE_BUCKET)")
	flag.StringVar(&opts.prefix, "prefix", "batch-transcribe", "S3 key prefix for temporary media and output JSON")
	flag.StringVar(&opts.region, "region", "", "AWS region (defaults to AWS_REGION or us-east-1)")
	flag.DurationVar(&opts.timeout, "timeout", 2*time.Hour, "timeout per transcription job")
	flag.DurationVar(&opts.pollInterval, "poll", 30*time.Second, "poll interval while waiting for AWS jobs")
	flag.IntVar(&opts.expireDays, "expire-days", 7, "S3 lifecycle expiration in days when -ensure-bucket is used")
	flag.IntVar(&opts.maxSpeakers, "max-speakers", 2, "maximum speaker labels to request from Transcribe Medical")
	flag.BoolVar(&opts.overwrite, "overwrite", false, "overwrite existing transcript files")
	flag.BoolVar(&opts.dryRun, "dry-run", false, "print planned jobs without uploading or calling AWS")
	flag.BoolVar(&opts.ensureBucket, "ensure-bucket", false, "create/configure the S3 bucket with private access, SSE-S3, and lifecycle expiration")
	flag.BoolVar(&opts.deleteAudio, "delete-audio", true, "delete uploaded source audio from S3 after each job finishes")
	flag.BoolVar(&opts.keepJSON, "keep-json", false, "write raw AWS transcript JSON next to each .txt transcript")
	flag.Parse()

	_ = godotenv.Load()
	if opts.region == "" {
		opts.region = getenv("AWS_REGION", "us-east-1")
	}
	if opts.bucket == "" {
		opts.bucket = os.Getenv("AWS_TRANSCRIBE_BUCKET")
	}
	if opts.bucket == "" && !opts.dryRun {
		log.Fatalf("S3 bucket is required: pass -bucket or set AWS_TRANSCRIBE_BUCKET")
	}

	files, err := audioFiles(opts.input)
	if err != nil {
		log.Fatalf("find recordings: %v", err)
	}
	if len(files) == 0 {
		log.Fatalf("no supported audio files found in %s", opts.input)
	}

	if err := os.MkdirAll(opts.outDir, 0o755); err != nil {
		log.Fatalf("create output directory: %v", err)
	}

	plans, err := buildPlans(opts, files)
	if err != nil {
		log.Fatalf("plan jobs: %v", err)
	}
	if len(plans) == 0 {
		log.Printf("nothing to do; all transcripts already exist")
		return
	}

	log.Printf("planned %d batch transcription job(s)", len(plans))
	if opts.dryRun {
		for _, plan := range plans {
			fmt.Printf("%s -> s3://%s/%s -> %s\n", plan.audioPath, opts.bucket, plan.inputKey, plan.outPath)
		}
		return
	}

	client, err := transcribe.NewBatchClient(context.Background(), opts.region)
	if err != nil {
		log.Fatalf("create batch transcribe client: %v", err)
	}
	if opts.ensureBucket {
		log.Printf("ensuring s3://%s exists and is private/encrypted with %d-day lifecycle", opts.bucket, opts.expireDays)
		if err := client.EnsureTemporaryBucket(context.Background(), opts.bucket, int32(opts.expireDays)); err != nil {
			log.Fatalf("ensure bucket: %v", err)
		}
	}

	var failed int
	for i, plan := range plans {
		if err := runPlan(client, opts, i+1, len(plans), plan); err != nil {
			log.Printf("[%d/%d] failed %s: %v", i+1, len(plans), plan.audioPath, err)
			failed++
		}
	}
	if failed > 0 {
		log.Fatalf("completed with %d failure(s)", failed)
	}
}

type jobPlan struct {
	audioPath string
	outPath   string
	jsonPath  string
	jobName   string
	inputKey  string
	outputKey string
	format    string
}

func buildPlans(opts options, files []string) ([]jobPlan, error) {
	var plans []jobPlan
	for _, file := range files {
		outPath, err := transcriptPath(opts.input, opts.outDir, file)
		if err != nil {
			return nil, err
		}
		if !opts.overwrite {
			if _, err := os.Stat(outPath); err == nil {
				log.Printf("skipping %s; transcript exists at %s", file, outPath)
				continue
			} else if !errors.Is(err, os.ErrNotExist) {
				return nil, fmt.Errorf("stat transcript %s: %w", outPath, err)
			}
		}

		format, err := transcribe.MediaFormatForExtension(filepath.Ext(file))
		if err != nil {
			return nil, err
		}
		jobName := jobNameFor(file)
		fileName := filepath.Base(file)
		plans = append(plans, jobPlan{
			audioPath: file,
			outPath:   outPath,
			jsonPath:  strings.TrimSuffix(outPath, filepath.Ext(outPath)) + ".aws.json",
			jobName:   jobName,
			inputKey:  cleanS3Key(opts.prefix, "input", jobName, fileName),
			outputKey: cleanS3Key(opts.prefix, "output", jobName+".json"),
			format:    string(format),
		})
	}
	return plans, nil
}

func runPlan(client *transcribe.BatchClient, opts options, index, total int, plan jobPlan) error {
	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
	defer cancel()

	start := time.Now()
	mediaURI := fmt.Sprintf("s3://%s/%s", opts.bucket, plan.inputKey)
	log.Printf("[%d/%d] uploading %s to %s", index, total, plan.audioPath, mediaURI)
	if err := client.UploadFile(ctx, opts.bucket, plan.inputKey, plan.audioPath); err != nil {
		return err
	}
	if opts.deleteAudio {
		defer func() {
			if err := client.DeleteObject(context.Background(), opts.bucket, plan.inputKey); err != nil {
				log.Printf("[%d/%d] warning: could not delete uploaded audio %s: %v", index, total, mediaURI, err)
			}
		}()
	}

	format, err := transcribe.MediaFormatForExtension(filepath.Ext(plan.audioPath))
	if err != nil {
		return err
	}
	log.Printf("[%d/%d] starting Transcribe Medical job %s", index, total, plan.jobName)
	if err := client.StartMedicalBatchJob(ctx, transcribe.BatchJobOptions{
		JobName:      plan.jobName,
		MediaURI:     mediaURI,
		MediaFormat:  format,
		OutputBucket: opts.bucket,
		OutputKey:    plan.outputKey,
		MaxSpeakers:  int32(opts.maxSpeakers),
	}); err != nil {
		return err
	}

	job, err := client.WaitMedicalBatchJob(ctx, plan.jobName, opts.pollInterval)
	if err != nil {
		return err
	}
	transcriptURI := ""
	if job.Transcript != nil && job.Transcript.TranscriptFileUri != nil {
		transcriptURI = *job.Transcript.TranscriptFileUri
	}
	jsonData, err := client.DownloadTranscriptJSON(ctx, opts.bucket, plan.outputKey, transcriptURI)
	if err != nil {
		return err
	}
	text, err := transcribe.ExtractBatchTranscriptText(jsonData)
	if err != nil {
		return err
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return fmt.Errorf("empty transcript")
	}

	if err := os.MkdirAll(filepath.Dir(plan.outPath), 0o755); err != nil {
		return fmt.Errorf("create transcript directory: %w", err)
	}
	if err := os.WriteFile(plan.outPath, []byte(text+"\n"), 0o644); err != nil {
		return fmt.Errorf("write transcript: %w", err)
	}
	if opts.keepJSON {
		if err := os.WriteFile(plan.jsonPath, jsonData, 0o644); err != nil {
			return fmt.Errorf("write raw transcript JSON: %w", err)
		}
	}

	log.Printf("[%d/%d] wrote %s (%d chars, %s)", index, total, plan.outPath, len(text), time.Since(start).Round(time.Second))
	return nil
}

func defaultInputDir() string {
	if _, err := os.Stat("recordings"); err == nil {
		return "recordings"
	}
	return "../recordings"
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func audioFiles(input string) ([]string, error) {
	info, err := os.Stat(input)
	if err != nil {
		return nil, err
	}

	if !info.IsDir() {
		ext := strings.ToLower(filepath.Ext(input))
		if err := transcribe.ValidateAudioExtension(ext); err != nil {
			return nil, err
		}
		return []string{input}, nil
	}

	var files []string
	if err := filepath.WalkDir(input, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if transcribe.ValidateAudioExtension(ext) == nil {
			files = append(files, path)
		}
		return nil
	}); err != nil {
		return nil, err
	}

	sort.Strings(files)
	return files, nil
}

func transcriptPath(input, outDir, audioPath string) (string, error) {
	info, err := os.Stat(input)
	if err != nil {
		return "", err
	}

	var rel string
	if info.IsDir() {
		rel, err = filepath.Rel(input, audioPath)
		if err != nil {
			return "", err
		}
	} else {
		rel = filepath.Base(audioPath)
	}

	ext := filepath.Ext(rel)
	rel = strings.TrimSuffix(rel, ext) + ".txt"
	return filepath.Join(outDir, rel), nil
}

var invalidJobNameChars = regexp.MustCompile(`[^0-9A-Za-z._-]+`)

func jobNameFor(path string) string {
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	base = invalidJobNameChars.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-._")
	if base == "" {
		base = "recording"
	}
	if len(base) > 80 {
		base = base[:80]
	}

	abs, _ := filepath.Abs(path)
	h := sha1.Sum([]byte(fmt.Sprintf("%s-%d", abs, time.Now().UnixNano())))
	return fmt.Sprintf("janushc-dash-%s-%s", base, hex.EncodeToString(h[:])[:10])
}

func cleanS3Key(parts ...string) string {
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.Trim(part, "/")
		if part != "" {
			cleaned = append(cleaned, part)
		}
	}
	return strings.Join(cleaned, "/")
}
