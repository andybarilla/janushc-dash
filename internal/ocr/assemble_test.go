package ocr

import (
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/textract/types"
)

func line(text string, page int32) types.Block {
	return types.Block{BlockType: types.BlockTypeLine, Text: aws.String(text), Page: aws.Int32(page)}
}

func TestAssembleText_OrdersByPageAndJoinsLines(t *testing.T) {
	blocks := []types.Block{
		line("page two line", 2),
		line("Hello", 1),
		{BlockType: types.BlockTypeWord, Text: aws.String("ignored"), Page: aws.Int32(1)},
		line("World", 1),
	}

	got := AssembleText(blocks)
	want := "Hello\nWorld\n\npage two line"
	if got != want {
		t.Errorf("AssembleText = %q, want %q", got, want)
	}
}

func TestAssembleText_Empty(t *testing.T) {
	if got := AssembleText(nil); got != "" {
		t.Errorf("AssembleText(nil) = %q, want empty", got)
	}
}
