package ocr

import (
	"sort"
	"strings"

	"github.com/aws/aws-sdk-go-v2/service/textract/types"
)

// AssembleText turns Textract LINE blocks into plain text. Lines are kept in the
// order Textract returns them within a page; pages are emitted in ascending page
// order and separated by a blank line. Non-LINE blocks are ignored.
func AssembleText(blocks []types.Block) string {
	linesByPage := make(map[int32][]string)
	var pages []int32
	for _, b := range blocks {
		if b.BlockType != types.BlockTypeLine || b.Text == nil {
			continue
		}
		var page int32 = 1
		if b.Page != nil {
			page = *b.Page
		}
		if _, seen := linesByPage[page]; !seen {
			pages = append(pages, page)
		}
		linesByPage[page] = append(linesByPage[page], *b.Text)
	}

	sort.Slice(pages, func(i, j int) bool { return pages[i] < pages[j] })

	pageTexts := make([]string, 0, len(pages))
	for _, p := range pages {
		pageTexts = append(pageTexts, strings.Join(linesByPage[p], "\n"))
	}
	return strings.Join(pageTexts, "\n\n")
}
