package ocr

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/aws-sdk-go-v2/service/textract"
	"github.com/aws/aws-sdk-go-v2/service/textract/types"
	"github.com/aws/smithy-go"
)

// permissionProbeJobID is a syntactically plausible but nonexistent Textract job
// id used to probe permissions without starting a real job.
const permissionProbeJobID = "00000000000000000000000000000000000000000000000000000000000000ff"

// Client wraps AWS Textract (async document text detection) plus the S3 bucket
// used to stage uploaded documents for Textract and for original-file retrieval.
type Client struct {
	s3       *s3.Client
	textract *textract.Client
	bucket   string
}

// NewClient creates the S3 + Textract clients. bucket may be empty; handlers must
// check Configured() before use.
func NewClient(ctx context.Context, region, bucket string) (*Client, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	return &Client{
		s3:       s3.NewFromConfig(cfg),
		textract: textract.NewFromConfig(cfg),
		bucket:   bucket,
	}, nil
}

// Configured reports whether an S3 bucket is set.
func (c *Client) Configured() bool { return c.bucket != "" }

// PutObject stores bytes in S3 under key with SSE-S3 encryption.
func (c *Client) PutObject(ctx context.Context, key string, body []byte, contentType string) error {
	input := &s3.PutObjectInput{
		Bucket:               aws.String(c.bucket),
		Key:                  aws.String(key),
		Body:                 bytes.NewReader(body),
		ServerSideEncryption: s3types.ServerSideEncryptionAes256,
	}
	if contentType != "" {
		input.ContentType = aws.String(contentType)
	}
	if _, err := c.s3.PutObject(ctx, input); err != nil {
		return fmt.Errorf("put s3://%s/%s: %w", c.bucket, key, err)
	}
	return nil
}

// GetObject streams an object from S3. The caller must close the returned reader.
func (c *Client) GetObject(ctx context.Context, key string) (io.ReadCloser, string, error) {
	out, err := c.s3.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(c.bucket), Key: aws.String(key)})
	if err != nil {
		return nil, "", fmt.Errorf("get s3://%s/%s: %w", c.bucket, key, err)
	}
	contentType := ""
	if out.ContentType != nil {
		contentType = *out.ContentType
	}
	return out.Body, contentType, nil
}

// DeleteObject removes an object from S3.
func (c *Client) DeleteObject(ctx context.Context, key string) error {
	if _, err := c.s3.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(c.bucket), Key: aws.String(key)}); err != nil {
		return fmt.Errorf("delete s3://%s/%s: %w", c.bucket, key, err)
	}
	return nil
}

// StartTextDetection begins an async Textract job for the S3 object at key and
// returns the job id.
func (c *Client) StartTextDetection(ctx context.Context, key string) (string, error) {
	out, err := c.textract.StartDocumentTextDetection(ctx, &textract.StartDocumentTextDetectionInput{
		DocumentLocation: &types.DocumentLocation{
			S3Object: &types.S3Object{Bucket: aws.String(c.bucket), Name: aws.String(key)},
		},
	})
	if err != nil {
		return "", fmt.Errorf("start text detection for %s: %w", key, err)
	}
	if out.JobId == nil {
		return "", errors.New("textract returned no job id")
	}
	return *out.JobId, nil
}

// WaitTextDetection polls until the Textract job finishes, then returns the
// assembled text. It paginates all result pages on success.
func (c *Client) WaitTextDetection(ctx context.Context, jobID string, pollInterval time.Duration) (string, error) {
	if pollInterval <= 0 {
		pollInterval = 5 * time.Second
	}
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		status, statusMessage, err := c.jobStatus(ctx, jobID)
		if err != nil {
			return "", err
		}
		switch status {
		case types.JobStatusSucceeded:
			return c.collectText(ctx, jobID)
		case types.JobStatusFailed:
			if statusMessage != "" {
				return "", fmt.Errorf("textract job failed: %s", statusMessage)
			}
			return "", errors.New("textract job failed")
		}

		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-ticker.C:
		}
	}
}

func (c *Client) jobStatus(ctx context.Context, jobID string) (types.JobStatus, string, error) {
	out, err := c.textract.GetDocumentTextDetection(ctx, &textract.GetDocumentTextDetectionInput{
		JobId: aws.String(jobID),
	})
	if err != nil {
		return "", "", fmt.Errorf("get text detection %s: %w", jobID, err)
	}
	statusMessage := ""
	if out.StatusMessage != nil {
		statusMessage = *out.StatusMessage
	}
	return out.JobStatus, statusMessage, nil
}

func (c *Client) collectText(ctx context.Context, jobID string) (string, error) {
	var blocks []types.Block
	var nextToken *string
	for {
		out, err := c.textract.GetDocumentTextDetection(ctx, &textract.GetDocumentTextDetectionInput{
			JobId:     aws.String(jobID),
			NextToken: nextToken,
		})
		if err != nil {
			return "", fmt.Errorf("get text detection page %s: %w", jobID, err)
		}
		blocks = append(blocks, out.Blocks...)
		if out.NextToken == nil || *out.NextToken == "" {
			break
		}
		nextToken = out.NextToken
	}
	return AssembleText(blocks), nil
}

// CheckPermissions probes Textract with a harmless GetDocumentTextDetection call.
// IAM authorization is evaluated before the (nonexistent) job id is validated, so a
// missing textract permission surfaces as AccessDenied. It returns an error only
// when the credentials lack Textract permission; the expected "invalid job id"
// response and transient/network errors are treated as permission-present.
func (c *Client) CheckPermissions(ctx context.Context) error {
	_, err := c.textract.GetDocumentTextDetection(ctx, &textract.GetDocumentTextDetectionInput{
		JobId: aws.String(permissionProbeJobID),
	})
	if isAccessDenied(err) {
		return err
	}
	return nil
}

// isAccessDenied reports whether err is an AWS authorization failure.
func isAccessDenied(err error) bool {
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "AccessDeniedException", "UnauthorizedException":
			return true
		}
	}
	return false
}
