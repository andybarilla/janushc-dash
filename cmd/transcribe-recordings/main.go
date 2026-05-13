package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/andybarilla/janushc-dash/internal/transcribe"
	"github.com/joho/godotenv"
)

type options struct {
	input     string
	outDir    string
	region    string
	timeout   time.Duration
	overwrite bool
	dryRun    bool
}

func main() {
	var opts options
	flag.StringVar(&opts.input, "input", defaultInputDir(), "audio file or directory to transcribe")
	flag.StringVar(&opts.outDir, "out", "tmp/transcripts", "directory for transcript .txt files")
	flag.StringVar(&opts.region, "region", "", "AWS region (defaults to AWS_REGION or config default)")
	flag.DurationVar(&opts.timeout, "timeout", 15*time.Minute, "timeout per recording")
	flag.BoolVar(&opts.overwrite, "overwrite", false, "overwrite existing transcript files")
	flag.BoolVar(&opts.dryRun, "dry-run", false, "print recordings that would be transcribed without calling AWS")
	flag.Parse()

	_ = godotenv.Load()
	if opts.region == "" {
		opts.region = getenv("AWS_REGION", "us-east-1")
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

	log.Printf("found %d recording(s)", len(files))
	if opts.dryRun {
		for _, file := range files {
			outPath, err := transcriptPath(opts.input, opts.outDir, file)
			if err != nil {
				log.Fatalf("build output path: %v", err)
			}
			fmt.Printf("%s -> %s\n", file, outPath)
		}
		return
	}

	client, err := transcribe.NewClient(context.Background(), opts.region)
	if err != nil {
		log.Fatalf("create transcribe client: %v", err)
	}

	var failed int
	for i, file := range files {
		outPath, err := transcriptPath(opts.input, opts.outDir, file)
		if err != nil {
			log.Printf("[%d/%d] %s: output path error: %v", i+1, len(files), file, err)
			failed++
			continue
		}

		if !opts.overwrite {
			if _, err := os.Stat(outPath); err == nil {
				log.Printf("[%d/%d] skipping %s; transcript exists at %s", i+1, len(files), file, outPath)
				continue
			} else if !errors.Is(err, os.ErrNotExist) {
				log.Printf("[%d/%d] %s: stat transcript: %v", i+1, len(files), file, err)
				failed++
				continue
			}
		}

		log.Printf("[%d/%d] transcribing %s", i+1, len(files), file)
		start := time.Now()
		transcript, err := transcribeFile(client, file, opts.timeout)
		if err != nil {
			log.Printf("[%d/%d] failed %s: %v", i+1, len(files), file, err)
			failed++
			continue
		}

		if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
			log.Printf("[%d/%d] %s: create transcript directory: %v", i+1, len(files), file, err)
			failed++
			continue
		}
		if err := os.WriteFile(outPath, []byte(transcript+"\n"), 0o644); err != nil {
			log.Printf("[%d/%d] %s: write transcript: %v", i+1, len(files), file, err)
			failed++
			continue
		}

		log.Printf("[%d/%d] wrote %s (%d chars, %s)", i+1, len(files), outPath, len(transcript), time.Since(start).Round(time.Second))
	}

	if failed > 0 {
		log.Fatalf("completed with %d failure(s)", failed)
	}
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

func transcribeFile(client transcribe.Transcriber, path string, timeout time.Duration) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open recording: %w", err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return "", fmt.Errorf("stat recording: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	progress := newProgressReader(file, info.Size(), filepath.Base(path), time.Minute)
	flacReader, cleanup, err := transcribe.ConvertToFLAC(ctx, progress)
	if err != nil {
		return "", fmt.Errorf("convert to FLAC: %w", err)
	}
	defer cleanup()

	transcript, err := client.Transcribe(ctx, &transcribe.AudioInput{
		Reader:     flacReader,
		SampleRate: transcribe.DefaultSampleRate(),
	})
	if err != nil {
		return "", fmt.Errorf("transcribe: %w", err)
	}
	progress.finish()

	transcript = strings.TrimSpace(transcript)
	if transcript == "" {
		return "", fmt.Errorf("empty transcript")
	}
	return transcript, nil
}

type progressReader struct {
	r        *os.File
	total    int64
	read     int64
	label    string
	interval time.Duration
	lastLog  time.Time
}

func newProgressReader(r *os.File, total int64, label string, interval time.Duration) *progressReader {
	return &progressReader{
		r:        r,
		total:    total,
		label:    label,
		interval: interval,
		lastLog:  time.Now(),
	}
}

func (r *progressReader) Read(p []byte) (int, error) {
	n, err := r.r.Read(p)
	if n > 0 {
		r.read += int64(n)
		if time.Since(r.lastLog) >= r.interval {
			r.log("in progress")
			r.lastLog = time.Now()
		}
	}
	return n, err
}

func (r *progressReader) finish() {
	r.log("finished")
}

func (r *progressReader) log(status string) {
	if r.total <= 0 {
		log.Printf("%s: %s, read %d bytes", r.label, status, r.read)
		return
	}
	pct := float64(r.read) / float64(r.total) * 100
	log.Printf("%s: %s, read %.1f%% (%d/%d bytes)", r.label, status, pct, r.read, r.total)
}
