package bedrock

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
)

type Client struct {
	runtime *bedrockruntime.Client
	modelID string
}

func NewClient(ctx context.Context, region, modelID string) (*Client, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	return &Client{
		runtime: bedrockruntime.NewFromConfig(cfg),
		modelID: modelID,
	}, nil
}

func (c *Client) Complete(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error) {
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
		return "", fmt.Errorf("marshal request: %w", err)
	}

	contentType := "application/json"
	resp, err := c.runtime.InvokeModel(ctx, &bedrockruntime.InvokeModelInput{
		ModelId:     &c.modelID,
		Body:        body,
		ContentType: &contentType,
	})
	if err != nil {
		return "", fmt.Errorf("invoke model: %w", err)
	}

	var result struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(resp.Body, &result); err != nil {
		return "", fmt.Errorf("unmarshal response: %w", err)
	}
	if len(result.Content) == 0 {
		return "", fmt.Errorf("empty response from model")
	}
	return result.Content[0].Text, nil
}
