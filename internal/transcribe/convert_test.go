package transcribe

import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestConvertToFLACProducesTranscribeCompatibleAudio(t *testing.T) {
	requireCommand(t, "ffmpeg")
	requireCommand(t, "ffprobe")

	tmp := t.TempDir()
	sourcePath := filepath.Join(tmp, "source.webm")
	generate := exec.Command(
		"ffmpeg",
		"-hide_banner",
		"-loglevel", "error",
		"-y",
		"-f", "lavfi",
		"-i", "sine=frequency=1000:duration=1",
		"-c:a", "libopus",
		sourcePath,
	)
	if output, err := generate.CombinedOutput(); err != nil {
		t.Skipf("ffmpeg cannot generate opus webm fixture: %v (%s)", err, strings.TrimSpace(string(output)))
	}

	source, err := os.Open(sourcePath)
	if err != nil {
		t.Fatalf("open source fixture: %v", err)
	}
	defer source.Close()

	flacReader, cleanup, err := ConvertToFLAC(context.Background(), source)
	if err != nil {
		t.Fatalf("ConvertToFLAC: %v", err)
	}
	flacData, readErr := io.ReadAll(flacReader)
	cleanup()
	if readErr != nil {
		t.Fatalf("read converted FLAC: %v", readErr)
	}

	flacPath := filepath.Join(tmp, "converted.flac")
	if err := os.WriteFile(flacPath, flacData, 0o600); err != nil {
		t.Fatalf("write converted FLAC: %v", err)
	}

	probe := exec.Command(
		"ffprobe",
		"-v", "error",
		"-select_streams", "a:0",
		"-show_entries", "stream=sample_rate,channels,sample_fmt,bits_per_raw_sample",
		"-of", "default=noprint_wrappers=1:nokey=1",
		flacPath,
	)
	output, err := probe.CombinedOutput()
	if err != nil {
		t.Fatalf("ffprobe converted FLAC: %v (%s)", err, strings.TrimSpace(string(output)))
	}

	fields := strings.Fields(string(output))
	if len(fields) != 4 {
		t.Fatalf("unexpected ffprobe output %q", string(output))
	}
	if fields[0] != "s16" || fields[1] != "16000" || fields[2] != "1" || fields[3] != "16" {
		t.Fatalf("converted audio = sample_fmt %s, sample_rate %s, channels %s, bits %s; want s16, 16000, 1, 16", fields[0], fields[1], fields[2], fields[3])
	}
}

func requireCommand(t *testing.T, name string) {
	t.Helper()
	if _, err := exec.LookPath(name); err != nil {
		t.Skipf("%s not installed", name)
	}
}
