package ocr

import "testing"

func TestValidateExt(t *testing.T) {
	valid := []string{".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".PDF", ".JPG"}
	for _, ext := range valid {
		if err := ValidateExt(ext); err != nil {
			t.Errorf("ValidateExt(%q) = %v, want nil", ext, err)
		}
	}
	invalid := []string{".docx", ".txt", ".gif", ""}
	for _, ext := range invalid {
		if err := ValidateExt(ext); err == nil {
			t.Errorf("ValidateExt(%q) = nil, want error", ext)
		}
	}
}

func TestContentTypeForFilename(t *testing.T) {
	cases := map[string]string{
		"scan.pdf":  "application/pdf",
		"x.PNG":     "image/png",
		"y.jpeg":    "image/jpeg",
		"z.tiff":    "image/tiff",
		"weird.bin": "application/octet-stream",
	}
	for name, want := range cases {
		if got := ContentTypeForFilename(name); got != want {
			t.Errorf("ContentTypeForFilename(%q) = %q, want %q", name, got, want)
		}
	}
}
