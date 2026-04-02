package transcribe

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/transcribestreaming"
	"github.com/aws/aws-sdk-go-v2/service/transcribestreaming/types"
)

const chunkSize = 8192 // 8KB chunks for streaming audio

// Client wraps the AWS Transcribe Medical streaming API.
type Client struct {
	streaming *transcribestreaming.Client
}

// NewClient creates a new AWS Transcribe Medical streaming client.
func NewClient(ctx context.Context, region string) (*Client, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	return &Client{
		streaming: transcribestreaming.NewFromConfig(cfg),
	}, nil
}

// Transcribe streams audio to AWS Transcribe Medical and returns the transcript.
// The audio in AudioInput.Reader must be FLAC-encoded (use ffmpeg to convert beforehand).
func (c *Client) Transcribe(ctx context.Context, audio *AudioInput) (string, error) {
	resp, err := c.streaming.StartMedicalStreamTranscription(ctx, &transcribestreaming.StartMedicalStreamTranscriptionInput{
		LanguageCode:         types.LanguageCodeEnUs,
		MediaEncoding:        types.MediaEncodingFlac,
		MediaSampleRateHertz: aws.Int32(audio.SampleRate),
		Specialty:            types.SpecialtyPrimarycare,
		Type:                 types.TypeDictation,
	})
	if err != nil {
		return "", fmt.Errorf("start medical stream transcription: %w", err)
	}

	stream := resp.GetStream()
	defer stream.Close()

	// Send audio chunks in a goroutine
	sendErr := make(chan error, 1)
	go func() {
		defer stream.Close()
		buf := make([]byte, chunkSize)
		for {
			n, readErr := audio.Reader.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				if err := stream.Send(ctx, &types.AudioStreamMemberAudioEvent{
					Value: types.AudioEvent{AudioChunk: chunk},
				}); err != nil {
					sendErr <- fmt.Errorf("send audio chunk: %w", err)
					return
				}
			}
			if readErr != nil {
				break
			}
		}
		sendErr <- nil
	}()

	// Collect transcript from results
	var transcript strings.Builder
	for event := range stream.Events() {
		switch v := event.(type) {
		case *types.MedicalTranscriptResultStreamMemberTranscriptEvent:
			for _, result := range v.Value.Transcript.Results {
				if result.IsPartial {
					continue
				}
				for _, alt := range result.Alternatives {
					if alt.Transcript != nil {
						transcript.WriteString(*alt.Transcript)
						transcript.WriteString(" ")
					}
				}
			}
		}
	}

	if err := <-sendErr; err != nil {
		return "", err
	}
	if err := stream.Err(); err != nil {
		return "", fmt.Errorf("stream error: %w", err)
	}

	return strings.TrimSpace(transcript.String()), nil
}
