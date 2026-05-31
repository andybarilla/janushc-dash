package athena

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

type capturedRequest struct {
	method      string
	path        string
	contentType string
	form        url.Values
}

// encounterWriteServer returns an httptest server that issues tokens, serves a
// fixed GET response for chart sections, and records every non-token request.
func encounterWriteServer(t *testing.T, getResponses map[string]string) (*httptest.Server, *[]capturedRequest) {
	t.Helper()
	var captured []capturedRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/v1/token" {
			w.Write([]byte(`{"access_token":"t","expires_in":3600}`))
			return
		}
		body, _ := io.ReadAll(r.Body)
		req := capturedRequest{method: r.Method, path: r.URL.Path, contentType: r.Header.Get("Content-Type")}
		if form, err := url.ParseQuery(string(body)); err == nil {
			req.form = form
		}
		captured = append(captured, req)

		if r.Method == http.MethodGet {
			if resp, ok := getResponses[r.URL.Path]; ok {
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(resp))
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":"true"}`))
	}))
	return server, &captured
}

func TestWriteEncounterAssessmentPlan(t *testing.T) {
	server, captured := encounterWriteServer(t, nil)
	defer server.Close()

	c := NewClient(server.URL, "id", "secret")
	err := c.WriteEncounterAssessmentPlan(context.Background(), "195900", "enc1", "A&P: stable.")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	reqs := *captured
	if len(reqs) != 1 {
		t.Fatalf("expected 1 request (PUT only, no GET), got %d", len(reqs))
	}
	put := reqs[0]
	if put.method != http.MethodPut || put.path != "/v1/195900/chart/encounter/enc1/assessment" {
		t.Errorf("unexpected request: %s %s", put.method, put.path)
	}
	if !strings.Contains(put.contentType, "application/x-www-form-urlencoded") {
		t.Errorf("expected form-urlencoded, got %q", put.contentType)
	}
	if put.form.Get("assessmenttext") != "A&P: stable." {
		t.Errorf("assessmenttext = %q, want our note", put.form.Get("assessmenttext"))
	}
	if put.form.Get("replacetext") == "" {
		t.Error("expected replacetext to be set")
	}
}

func TestWriteEncounterHPI_GetsThenPutsPreservingArray(t *testing.T) {
	getBody := `{"hpi":[{"paragraph":"existing finding"}],"sectionnote":"old note"}`
	server, captured := encounterWriteServer(t, map[string]string{
		"/v1/195900/chart/encounter/enc1/hpi": getBody,
	})
	defer server.Close()

	c := NewClient(server.URL, "id", "secret")
	err := c.WriteEncounterHPI(context.Background(), "195900", "enc1", "HPI dictated note.")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	reqs := *captured
	if len(reqs) != 2 {
		t.Fatalf("expected GET then PUT (2 requests), got %d", len(reqs))
	}
	if reqs[0].method != http.MethodGet || reqs[1].method != http.MethodPut {
		t.Fatalf("expected GET then PUT, got %s then %s", reqs[0].method, reqs[1].method)
	}
	put := reqs[1]
	if put.form.Get("sectionnote") != "HPI dictated note." {
		t.Errorf("sectionnote = %q, want our note", put.form.Get("sectionnote"))
	}
	// The full hpi array from the GET must be echoed back, or athena deletes it.
	if got := put.form.Get("hpi"); !strings.Contains(got, "existing finding") {
		t.Errorf("hpi = %q, want the GET array echoed back to preserve existing findings", got)
	}
}

func TestWriteEncounterPhysicalExam_GetsThenPutsPreservingTemplates(t *testing.T) {
	getBody := `{"physicalexam":[{"paragraph":"normal"}],"templatedata":[{"templateid":42,"name":"Standard PE"}]}`
	server, captured := encounterWriteServer(t, map[string]string{
		"/v1/195900/chart/encounter/enc1/physicalexam": getBody,
	})
	defer server.Close()

	c := NewClient(server.URL, "id", "secret")
	err := c.WriteEncounterPhysicalExam(context.Background(), "195900", "enc1", "PE dictated note.")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	reqs := *captured
	if len(reqs) != 2 {
		t.Fatalf("expected GET then PUT (2 requests), got %d", len(reqs))
	}
	put := reqs[1]
	if put.method != http.MethodPut || put.path != "/v1/195900/chart/encounter/enc1/physicalexam" {
		t.Errorf("unexpected PUT: %s %s", put.method, put.path)
	}
	if put.form.Get("sectionnote") != "PE dictated note." {
		t.Errorf("sectionnote = %q, want our note", put.form.Get("sectionnote"))
	}
	// Existing template ids must be passed back, or athena removes those templates.
	if got := put.form.Get("templateids"); !strings.Contains(got, "42") {
		t.Errorf("templateids = %q, want existing template 42 preserved", got)
	}
}

func TestWriteEncounterAssessmentPlan_ErrorResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/v1/token" {
			w.Write([]byte(`{"access_token":"t","expires_in":3600}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"success":"false","errormessage":"encounter is closed"}`))
	}))
	defer server.Close()

	c := NewClient(server.URL, "id", "secret")
	err := c.WriteEncounterAssessmentPlan(context.Background(), "195900", "enc1", "note")
	if err == nil {
		t.Fatal("expected error when athena reports failure")
	}
	if !strings.Contains(err.Error(), "encounter is closed") {
		t.Errorf("error = %v, want athena errormessage surfaced", err)
	}
}
