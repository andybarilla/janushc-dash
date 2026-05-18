package bedrock

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
)

type CompletionResult struct {
	Text         string
	ModelID      string
	InputTokens  int32
	OutputTokens int32
}

type Client struct {
	runtime *bedrockruntime.Client
	region  string
	modelID string
}

func NewClient(ctx context.Context, region, modelID string) (*Client, error) {
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return nil, fmt.Errorf("bedrock model ID is empty; set AWS_BEDROCK_MODEL_ID")
	}

	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	return &Client{
		runtime: bedrockruntime.NewFromConfig(cfg),
		region:  region,
		modelID: modelID,
	}, nil
}

func (c *Client) Complete(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (CompletionResult, error) {
	input := map[string]any{
		"anthropic_version": "bedrock-2023-05-31",
		"max_tokens":        maxTokens,
		"system":            systemPrompt,
		"messages": []map[string]string{
			{"role": "user", "content": userPrompt},
		},
	}

	body, err := json.Marshal(input)
	if err != nil {
		return CompletionResult{}, fmt.Errorf("marshal request: %w", err)
	}

	contentType := "application/json"
	resp, err := c.runtime.InvokeModel(ctx, &bedrockruntime.InvokeModelInput{
		ModelId:     &c.modelID,
		Body:        body,
		ContentType: &contentType,
	})
	if err != nil {
		return CompletionResult{}, fmt.Errorf("invoke model %q in region %q: %w", c.modelID, c.region, err)
	}

	return parseCompletionResult(resp.Body, c.modelID)
}

func parseCompletionResult(body []byte, modelID string) (CompletionResult, error) {
	var response struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
		Usage struct {
			InputTokens  int32 `json:"input_tokens"`
			OutputTokens int32 `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return CompletionResult{}, fmt.Errorf("unmarshal response: %w", err)
	}
	if len(response.Content) == 0 {
		return CompletionResult{}, fmt.Errorf("empty response from model")
	}
	return CompletionResult{
		Text:         response.Content[0].Text,
		ModelID:      modelID,
		InputTokens:  response.Usage.InputTokens,
		OutputTokens: response.Usage.OutputTokens,
	}, nil
}
