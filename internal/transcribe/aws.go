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
		Type:                 types.TypeConversation,
		ShowSpeakerLabel:     true,
	})
	if err != nil {
		return "", fmt.Errorf("start medical stream transcription: %w", err)
	}

	stream := resp.GetStream()

	// Send audio chunks in a goroutine. The goroutine owns closing the stream
	// to signal end-of-audio to the server.
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

	// Collect transcript from final results. With speaker labeling enabled,
	// alternatives include word-level speaker labels; preserve those as readable
	// line breaks instead of returning one long paragraph.
	var transcript strings.Builder
	for event := range stream.Events() {
		switch v := event.(type) {
		case *types.MedicalTranscriptResultStreamMemberTranscriptEvent:
			for _, result := range v.Value.Transcript.Results {
				if result.IsPartial {
					continue
				}
				for _, alt := range result.Alternatives {
					appendMedicalAlternativeTranscript(&transcript, alt)
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

func appendMedicalAlternativeTranscript(transcript *strings.Builder, alt types.MedicalAlternative) {
	if !hasSpeakerLabels(alt.Items) {
		if alt.Transcript != nil && strings.TrimSpace(*alt.Transcript) != "" {
			appendTranscriptLine(transcript, strings.TrimSpace(*alt.Transcript))
		}
		return
	}

	var line strings.Builder
	currentSpeaker := ""
	flush := func() {
		text := strings.TrimSpace(line.String())
		if text != "" {
			appendTranscriptLine(transcript, text)
		}
		line.Reset()
	}

	for _, item := range alt.Items {
		if item.Content == nil {
			continue
		}
		content := strings.TrimSpace(*item.Content)
		if content == "" {
			continue
		}

		if item.Speaker != nil && *item.Speaker != "" && *item.Speaker != currentSpeaker {
			flush()
			currentSpeaker = *item.Speaker
			line.WriteString(formatSpeakerLabel(currentSpeaker))
			line.WriteString(": ")
		}

		if item.Type == types.ItemTypePunctuation {
			line.WriteString(content)
			continue
		}

		if line.Len() > 0 && !strings.HasSuffix(line.String(), " ") {
			line.WriteString(" ")
		}
		line.WriteString(content)
	}
	flush()
}

func hasSpeakerLabels(items []types.MedicalItem) bool {
	for _, item := range items {
		if item.Speaker != nil && *item.Speaker != "" {
			return true
		}
	}
	return false
}

func appendTranscriptLine(transcript *strings.Builder, text string) {
	if transcript.Len() > 0 {
		transcript.WriteString("\n")
	}
	transcript.WriteString(text)
}

func formatSpeakerLabel(speaker string) string {
	if suffix, ok := strings.CutPrefix(speaker, "spk_"); ok {
		return "Speaker " + suffix
	}
	return speaker
}
