package transcribe

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	awstranscribe "github.com/aws/aws-sdk-go-v2/service/transcribe"
	transtypes "github.com/aws/aws-sdk-go-v2/service/transcribe/types"
)

// BatchClient wraps the AWS Transcribe Medical batch API plus the S3 bucket used
// for batch media input and JSON transcript output.
type BatchClient struct {
	s3         *s3.Client
	transcribe *awstranscribe.Client
	region     string
}

// BatchJobOptions describes one medical batch transcription job.
type BatchJobOptions struct {
	JobName      string
	MediaURI     string
	MediaFormat  transtypes.MediaFormat
	OutputBucket string
	OutputKey    string
	MaxSpeakers  int32
}

// NewBatchClient creates AWS S3 and Transcribe batch clients.
func NewBatchClient(ctx context.Context, region string) (*BatchClient, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	return &BatchClient{
		s3:         s3.NewFromConfig(cfg),
		transcribe: awstranscribe.NewFromConfig(cfg),
		region:     region,
	}, nil
}

// EnsureTemporaryBucket creates the bucket if needed, blocks public access,
// enables SSE-S3 encryption, and adds a whole-bucket expiration lifecycle rule.
func (c *BatchClient) EnsureTemporaryBucket(ctx context.Context, bucket string, expireDays int32) error {
	if bucket == "" {
		return errors.New("bucket is required")
	}
	if expireDays <= 0 {
		expireDays = 7
	}

	if _, err := c.s3.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(bucket)}); err != nil {
		input := &s3.CreateBucketInput{Bucket: aws.String(bucket)}
		if c.region != "" && c.region != "us-east-1" {
			input.CreateBucketConfiguration = &s3types.CreateBucketConfiguration{
				LocationConstraint: s3types.BucketLocationConstraint(c.region),
			}
		}
		if _, createErr := c.s3.CreateBucket(ctx, input); createErr != nil {
			return fmt.Errorf("create bucket %s: %w", bucket, createErr)
		}
		waiter := s3.NewBucketExistsWaiter(c.s3)
		if err := waiter.Wait(ctx, &s3.HeadBucketInput{Bucket: aws.String(bucket)}, 2*time.Minute); err != nil {
			return fmt.Errorf("wait for bucket %s: %w", bucket, err)
		}
	}

	if _, err := c.s3.PutPublicAccessBlock(ctx, &s3.PutPublicAccessBlockInput{
		Bucket: aws.String(bucket),
		PublicAccessBlockConfiguration: &s3types.PublicAccessBlockConfiguration{
			BlockPublicAcls:       aws.Bool(true),
			BlockPublicPolicy:     aws.Bool(true),
			IgnorePublicAcls:      aws.Bool(true),
			RestrictPublicBuckets: aws.Bool(true),
		},
	}); err != nil {
		return fmt.Errorf("configure public access block: %w", err)
	}

	if _, err := c.s3.PutBucketEncryption(ctx, &s3.PutBucketEncryptionInput{
		Bucket: aws.String(bucket),
		ServerSideEncryptionConfiguration: &s3types.ServerSideEncryptionConfiguration{
			Rules: []s3types.ServerSideEncryptionRule{{
				ApplyServerSideEncryptionByDefault: &s3types.ServerSideEncryptionByDefault{
					SSEAlgorithm: s3types.ServerSideEncryptionAes256,
				},
			}},
		},
	}); err != nil {
		return fmt.Errorf("configure bucket encryption: %w", err)
	}

	if _, err := c.s3.PutBucketLifecycleConfiguration(ctx, &s3.PutBucketLifecycleConfigurationInput{
		Bucket: aws.String(bucket),
		LifecycleConfiguration: &s3types.BucketLifecycleConfiguration{
			Rules: []s3types.LifecycleRule{{
				ID:     aws.String("expire-transcribe-artifacts"),
				Status: s3types.ExpirationStatusEnabled,
				Filter: &s3types.LifecycleRuleFilter{Prefix: aws.String("")},
				Expiration: &s3types.LifecycleExpiration{
					Days: aws.Int32(expireDays),
				},
				AbortIncompleteMultipartUpload: &s3types.AbortIncompleteMultipartUpload{
					DaysAfterInitiation: aws.Int32(1),
				},
			}},
		},
	}); err != nil {
		return fmt.Errorf("configure bucket lifecycle: %w", err)
	}

	return nil
}

// UploadFile uploads a local audio file to S3.
func (c *BatchClient) UploadFile(ctx context.Context, bucket, key, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open upload file: %w", err)
	}
	defer file.Close()

	input := &s3.PutObjectInput{
		Bucket:               aws.String(bucket),
		Key:                  aws.String(key),
		Body:                 file,
		ServerSideEncryption: s3types.ServerSideEncryptionAes256,
	}
	if contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(path))); contentType != "" {
		input.ContentType = aws.String(contentType)
	}
	if _, err := c.s3.PutObject(ctx, input); err != nil {
		return fmt.Errorf("upload s3://%s/%s: %w", bucket, key, err)
	}
	return nil
}

// DeleteObject deletes one object from S3.
func (c *BatchClient) DeleteObject(ctx context.Context, bucket, key string) error {
	_, err := c.s3.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		return fmt.Errorf("delete s3://%s/%s: %w", bucket, key, err)
	}
	return nil
}

// StartMedicalBatchJob starts a Transcribe Medical batch job for an S3 media URI.
func (c *BatchClient) StartMedicalBatchJob(ctx context.Context, opts BatchJobOptions) error {
	maxSpeakers := opts.MaxSpeakers
	if maxSpeakers <= 0 {
		maxSpeakers = 2
	}
	_, err := c.transcribe.StartMedicalTranscriptionJob(ctx, &awstranscribe.StartMedicalTranscriptionJobInput{
		MedicalTranscriptionJobName: aws.String(opts.JobName),
		LanguageCode:                transtypes.LanguageCodeEnUs,
		Media:                       &transtypes.Media{MediaFileUri: aws.String(opts.MediaURI)},
		MediaFormat:                 opts.MediaFormat,
		OutputBucketName:            aws.String(opts.OutputBucket),
		OutputKey:                   aws.String(opts.OutputKey),
		Specialty:                   transtypes.SpecialtyPrimarycare,
		Type:                        transtypes.TypeConversation,
		Settings: &transtypes.MedicalTranscriptionSetting{
			ShowSpeakerLabels: aws.Bool(true),
			MaxSpeakerLabels:  aws.Int32(maxSpeakers),
		},
		Tags: []transtypes.Tag{{Key: aws.String("Project"), Value: aws.String("janushc-dash")}},
	})
	if err != nil {
		return fmt.Errorf("start medical transcription job %s: %w", opts.JobName, err)
	}
	return nil
}

// WaitMedicalBatchJob polls until a Transcribe Medical batch job completes or fails.
func (c *BatchClient) WaitMedicalBatchJob(ctx context.Context, jobName string, pollInterval time.Duration) (*transtypes.MedicalTranscriptionJob, error) {
	if pollInterval <= 0 {
		pollInterval = 30 * time.Second
	}
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		job, err := c.getMedicalBatchJob(ctx, jobName)
		if err != nil {
			return nil, err
		}
		switch job.TranscriptionJobStatus {
		case transtypes.TranscriptionJobStatusCompleted:
			return job, nil
		case transtypes.TranscriptionJobStatusFailed:
			if job.FailureReason != nil {
				return job, fmt.Errorf("medical transcription job failed: %s", *job.FailureReason)
			}
			return job, errors.New("medical transcription job failed")
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (c *BatchClient) getMedicalBatchJob(ctx context.Context, jobName string) (*transtypes.MedicalTranscriptionJob, error) {
	out, err := c.transcribe.GetMedicalTranscriptionJob(ctx, &awstranscribe.GetMedicalTranscriptionJobInput{
		MedicalTranscriptionJobName: aws.String(jobName),
	})
	if err != nil {
		return nil, fmt.Errorf("get medical transcription job %s: %w", jobName, err)
	}
	if out.MedicalTranscriptionJob == nil {
		return nil, fmt.Errorf("medical transcription job %s not found", jobName)
	}
	return out.MedicalTranscriptionJob, nil
}

// DownloadTranscriptJSON downloads the transcript output from the configured S3
// location. Transcribe can return a TranscriptFileUri, but for caller-owned
// output buckets it may be an unsigned S3 URL that returns 403 over plain HTTP;
// the signed AWS SDK GetObject path is the reliable source of truth.
func (c *BatchClient) DownloadTranscriptJSON(ctx context.Context, bucket, key, transcriptURI string) ([]byte, error) {
	out, err := c.s3.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		return nil, fmt.Errorf("get transcript s3://%s/%s: %w", bucket, key, err)
	}
	defer out.Body.Close()
	return io.ReadAll(out.Body)
}

// MediaFormatForExtension maps supported local audio file extensions to AWS
// Transcribe batch media formats.
func MediaFormatForExtension(ext string) (transtypes.MediaFormat, error) {
	switch strings.ToLower(ext) {
	case ".mp3":
		return transtypes.MediaFormatMp3, nil
	case ".m4a":
		return transtypes.MediaFormatM4a, nil
	case ".wav":
		return transtypes.MediaFormatWav, nil
	case ".webm":
		return transtypes.MediaFormatWebm, nil
	case ".ogg":
		return transtypes.MediaFormatOgg, nil
	case ".flac":
		return transtypes.MediaFormatFlac, nil
	default:
		return "", fmt.Errorf("unsupported batch media format %q", ext)
	}
}

type batchTranscriptDocument struct {
	Results struct {
		Transcripts []struct {
			Transcript string `json:"transcript"`
		} `json:"transcripts"`
		Items         []batchTranscriptItem `json:"items"`
		SpeakerLabels struct {
			Segments []struct {
				Items []struct {
					StartTime    string `json:"start_time"`
					EndTime      string `json:"end_time"`
					SpeakerLabel string `json:"speaker_label"`
				} `json:"items"`
			} `json:"segments"`
		} `json:"speaker_labels"`
	} `json:"results"`
}

type batchTranscriptItem struct {
	Type         string `json:"type"`
	StartTime    string `json:"start_time"`
	EndTime      string `json:"end_time"`
	SpeakerLabel string `json:"speaker_label"`
	Alternatives []struct {
		Content string `json:"content"`
	} `json:"alternatives"`
}

// ExtractBatchTranscriptText converts AWS Transcribe JSON into readable text,
// preserving speaker labels when Transcribe included diarization data.
func ExtractBatchTranscriptText(data []byte) (string, error) {
	var doc batchTranscriptDocument
	if err := json.Unmarshal(data, &doc); err != nil {
		return "", fmt.Errorf("parse transcript JSON: %w", err)
	}

	labels := speakerLabelsByTime(doc)
	if len(doc.Results.Items) > 0 && len(labels) > 0 {
		text := renderBatchItems(doc.Results.Items, labels)
		if strings.TrimSpace(text) != "" {
			return text, nil
		}
	}

	if len(doc.Results.Transcripts) > 0 {
		return strings.TrimSpace(doc.Results.Transcripts[0].Transcript), nil
	}
	return "", errors.New("transcript JSON did not contain transcript text")
}

func ExtractBatchTranscriptDurationSeconds(data []byte) (float64, bool, error) {
	var doc batchTranscriptDocument
	if err := json.Unmarshal(data, &doc); err != nil {
		return 0, false, fmt.Errorf("parse transcript JSON: %w", err)
	}

	maxEnd := 0.0
	for _, item := range doc.Results.Items {
		if item.Type == "punctuation" || item.EndTime == "" {
			continue
		}
		value, err := strconv.ParseFloat(item.EndTime, 64)
		if err != nil {
			continue
		}
		if value > maxEnd {
			maxEnd = value
		}
	}
	if maxEnd <= 0 {
		return 0, false, nil
	}
	return maxEnd, true, nil
}

func speakerLabelsByTime(doc batchTranscriptDocument) map[string]string {
	labels := make(map[string]string)
	for _, segment := range doc.Results.SpeakerLabels.Segments {
		for _, item := range segment.Items {
			if item.StartTime != "" && item.SpeakerLabel != "" {
				labels[item.StartTime] = item.SpeakerLabel
			}
		}
	}
	for _, item := range doc.Results.Items {
		if item.StartTime != "" && item.SpeakerLabel != "" {
			labels[item.StartTime] = item.SpeakerLabel
		}
	}
	return labels
}

func renderBatchItems(items []batchTranscriptItem, labels map[string]string) string {
	var transcript strings.Builder
	var line strings.Builder
	currentSpeaker := ""
	flush := func() {
		text := strings.TrimSpace(line.String())
		if text != "" {
			appendTranscriptLine(&transcript, text)
		}
		line.Reset()
	}

	for _, item := range items {
		if len(item.Alternatives) == 0 || strings.TrimSpace(item.Alternatives[0].Content) == "" {
			continue
		}
		content := strings.TrimSpace(item.Alternatives[0].Content)
		if item.Type == "punctuation" {
			line.WriteString(content)
			continue
		}

		speaker := item.SpeakerLabel
		if speaker == "" {
			speaker = labels[item.StartTime]
		}
		if speaker != "" && speaker != currentSpeaker {
			flush()
			currentSpeaker = speaker
			line.WriteString(formatSpeakerLabel(speaker))
			line.WriteString(": ")
		}

		if line.Len() > 0 && !strings.HasSuffix(line.String(), " ") {
			line.WriteString(" ")
		}
		line.WriteString(content)
	}
	flush()
	return strings.TrimSpace(transcript.String())
}
