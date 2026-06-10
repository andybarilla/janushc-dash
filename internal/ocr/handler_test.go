package ocr

import "testing"

func TestValidateDocumentExt(t *testing.T) {
	valid := []string{".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".PDF", ".JPG"}
	for _, ext := range valid {
		if err := validateDocumentExt(ext); err != nil {
			t.Errorf("validateDocumentExt(%q) = %v, want nil", ext, err)
		}
	}
	invalid := []string{".docx", ".txt", ".gif", ""}
	for _, ext := range invalid {
		if err := validateDocumentExt(ext); err == nil {
			t.Errorf("validateDocumentExt(%q) = nil, want error", ext)
		}
	}
}

func TestDocumentS3Key(t *testing.T) {
	got := documentS3Key("tenant-1", "doc-9", "Scan Report.PDF")
	want := "ocr/tenant-1/doc-9.pdf"
	if got != want {
		t.Errorf("documentS3Key = %q, want %q", got, want)
	}
}
