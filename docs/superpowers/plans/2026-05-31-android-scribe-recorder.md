# Android Scribe Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a physician log into the Android app, pick one of the day's real athena encounters, record the visit in the background, and have the audio land as a real scribe session in the existing web inbox.

**Architecture:** Reuse the existing authenticated scribe endpoints (`POST /api/scribe/sessions` → `/upload`) from the app; add two read endpoints (`/api/scribe/departments`, `/api/scribe/encounters`) backed by athena; implement the athena `ListTodayEncounters` call. The app evolves the proven `mobile-recorder-spike` recording core, adds native Google Sign-In, an encounter picker, and a resilient create-then-upload queue. The unauthenticated `/api/mobile/recordings` spike endpoint is retired.

**Tech Stack:** Go (chi, pgx, sqlc), athena REST API, React Native / Expo (expo-av, AsyncStorage), `@react-native-google-signin/google-signin`, Jest (jest-expo).

---

## File Structure

**Backend:**
- `internal/emr/emr.go` — add `PatientName` to `Encounter` (modify).
- `internal/emr/athena/encounters.go` — implement `ListTodayEncounters` (modify).
- `internal/emr/athena/client_test.go` — add `ListTodayEncounters` test (modify).
- `internal/scribe/handler.go` — add `emr` field + `HandleListDepartments` / `HandleListEncounters` (modify).
- `internal/scribe/handler_test.go` — fake EMR + endpoint tests (modify).
- `internal/server/server.go` — mount two routes, drop mobile route (modify).
- `cmd/janushc-dash/main.go` — pass `athenaClient` into `scribe.NewHandler`, drop mobile wiring (modify).
- `internal/config/config.go` — drop `MobileSpikeToken` / `MobileRecordingsDir` (modify).
- `internal/mobile/` — delete.

**App (`mobile-recorder-spike/`):**
- `src/config.ts` — API base URL persistence (create).
- `src/api.ts` — typed fetch client with JWT + 401 handling (create).
- `src/auth.tsx` — Google Sign-In + JWT exchange + auth context (create).
- `src/upload-queue.ts` — pure create-then-upload state machine (create).
- `src/upload-queue.test.ts` — Jest tests for the queue (create).
- `src/screens/sign-in.tsx` — sign-in screen (create).
- `src/screens/pick-encounter.tsx` — department + encounter picker (create).
- `src/screens/record.tsx` — recording + upload screen (create).
- `App.tsx` — app shell / navigation between screens (rewrite).
- `app.json` — Android OAuth config + google-signin plugin (modify).
- `package.json` — add deps + jest (modify).
- `jest.config.js`, `jest.setup.js` — test harness (create).

---

## Task 1: Add PatientName to the Encounter type

**Files:**
- Modify: `internal/emr/emr.go`

- [ ] **Step 1: Add the field**

In `internal/emr/emr.go`, update the `Encounter` struct:

```go
type Encounter struct {
	ID           string `json:"id"`
	PatientID    string `json:"patient_id"`
	PatientName  string `json:"patient_name"`
	DepartmentID string `json:"department_id"`
	Date         string `json:"date"`
}
```

- [ ] **Step 2: Verify it compiles**

Run: `go build ./...`
Expected: builds clean (the field is additive; the athena stub still satisfies the interface).

- [ ] **Step 3: Commit**

```bash
git add internal/emr/emr.go
git commit -m "feat: add PatientName to emr.Encounter"
```

---

## Task 2: Implement athena ListTodayEncounters

**Files:**
- Modify: `internal/emr/athena/encounters.go`
- Test: `internal/emr/athena/client_test.go`

- [ ] **Step 1: Write the failing test**

Append to `internal/emr/athena/client_test.go`:

```go
func TestListTodayEncounters(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/oauth2/v1/token":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"access_token":"test-token","expires_in":3600}`))
		case r.URL.Path == "/v1/195900/appointments/booked":
			if r.URL.Query().Get("departmentid") != "1" {
				t.Errorf("expected departmentid=1, got %q", r.URL.Query().Get("departmentid"))
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"appointments":[
				{"appointmentid":"900","patientid":"55","date":"05/31/2026","starttime":"09:00"},
				{"appointmentid":"901","patientid":"55","date":"05/31/2026","starttime":"09:30"},
				{"appointmentid":"902","patientid":"66","date":"05/31/2026","starttime":"10:00"}
			]}`))
		case r.URL.Path == "/v1/195900/patients/55":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`[{"firstname":"Ada","lastname":"Lovelace"}]`))
		case r.URL.Path == "/v1/195900/patients/66":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`[{"firstname":"Alan","lastname":"Turing"}]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewClient(server.URL, "client-id", "client-secret")
	encs, err := client.ListTodayEncounters(context.Background(), "195900", "1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(encs) != 3 {
		t.Fatalf("expected 3 encounters, got %d", len(encs))
	}
	if encs[0].ID != "900" || encs[0].PatientID != "55" || encs[0].PatientName != "Ada Lovelace" {
		t.Errorf("unexpected first encounter: %+v", encs[0])
	}
	if encs[2].PatientName != "Alan Turing" {
		t.Errorf("expected name lookup for patient 66, got %q", encs[2].PatientName)
	}
	if encs[0].DepartmentID != "1" {
		t.Errorf("expected departmentid carried through, got %q", encs[0].DepartmentID)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/emr/athena/ -run TestListTodayEncounters -v`
Expected: FAIL — `ListTodayEncounters not yet implemented`.

- [ ] **Step 3: Implement the method**

Replace the stub `ListTodayEncounters` in `internal/emr/athena/encounters.go` with:

```go
func (c *Client) ListTodayEncounters(ctx context.Context, practiceID, departmentID string) ([]emr.Encounter, error) {
	today := time.Now().Format("01/02/2006")
	q := url.Values{
		"departmentid": {departmentID},
		"startdate":    {today},
		"enddate":      {today},
	}
	path := fmt.Sprintf("/v1/%s/appointments/booked?%s", practiceID, q.Encode())

	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, fmt.Errorf("list booked appointments: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list booked appointments failed (%d): %s", resp.StatusCode, body)
	}

	var result struct {
		Appointments []struct {
			AppointmentID string `json:"appointmentid"`
			PatientID     string `json:"patientid"`
			Date          string `json:"date"`
		} `json:"appointments"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode booked appointments: %w", err)
	}

	names := make(map[string]string)
	encounters := make([]emr.Encounter, 0, len(result.Appointments))
	for _, a := range result.Appointments {
		name, cached := names[a.PatientID]
		if !cached && a.PatientID != "" {
			if n, err := c.GetPatientName(ctx, practiceID, a.PatientID); err == nil {
				name = n
			}
			names[a.PatientID] = name
		}
		encounters = append(encounters, emr.Encounter{
			ID:           a.AppointmentID,
			PatientID:    a.PatientID,
			PatientName:  name,
			DepartmentID: departmentID,
			Date:         a.Date,
		})
	}
	return encounters, nil
}
```

Add `"time"` to the import block in `encounters.go` (the file already imports `context`, `encoding/json`, `fmt`, `io`, `net/url`, and the `emr` package).

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/emr/athena/ -run TestListTodayEncounters -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/emr/athena/encounters.go internal/emr/athena/client_test.go
git commit -m "feat: implement athena ListTodayEncounters"
```

---

## Task 3: Give the scribe Handler an EMR dependency

**Files:**
- Modify: `internal/scribe/handler.go`
- Modify: `cmd/janushc-dash/main.go`

- [ ] **Step 1: Add the field and constructor arg**

In `internal/scribe/handler.go`, update the struct and constructor:

```go
type Handler struct {
	queries   *database.Queries
	processor *Processor
	cfg       *config.Config
	batch     *transcribe.BatchClient
	emr       emr.EMR
}

func NewHandler(queries *database.Queries, processor *Processor, cfg *config.Config, batch *transcribe.BatchClient, emrClient emr.EMR) *Handler {
	return &Handler{queries: queries, processor: processor, cfg: cfg, batch: batch, emr: emrClient}
}
```

Add the import `"github.com/andybarilla/janushc-dash/internal/emr"` to `handler.go` if not already present.

- [ ] **Step 2: Update the caller**

In `cmd/janushc-dash/main.go`, the `athenaClient` is already constructed (used for `approval.NewHandler`). Update the scribe handler construction (around line 152) to pass it:

```go
scribeHandler := scribe.NewHandler(queries, scribeProcessor, cfg, transcribeBatchClient, athenaClient)
```

- [ ] **Step 3: Verify it compiles**

Run: `go build ./...`
Expected: builds clean.

- [ ] **Step 4: Run existing scribe tests**

Run: `go test ./internal/scribe/...`
Expected: PASS (handler tests construct via struct literal; the new field defaults to nil and is unused by existing tests).

- [ ] **Step 5: Commit**

```bash
git add internal/scribe/handler.go cmd/janushc-dash/main.go
git commit -m "refactor: inject EMR into scribe handler"
```

---

## Task 4: Departments endpoint

**Files:**
- Modify: `internal/scribe/handler.go`
- Modify: `internal/scribe/handler_test.go`
- Modify: `internal/server/server.go`

- [ ] **Step 1: Add a fake EMR to the scribe handler tests**

At the bottom of `internal/scribe/handler_test.go`, add a fake implementing `emr.EMR`. Add `"context"` and the `emr` import (`"github.com/andybarilla/janushc-dash/internal/emr"`) to the test file's import block:

```go
type fakeEMR struct {
	departments []emr.Department
	encounters  []emr.Encounter
	err         error
}

func (f fakeEMR) ListDepartments(ctx context.Context, practiceID string) ([]emr.Department, error) {
	return f.departments, f.err
}
func (f fakeEMR) ListTodayEncounters(ctx context.Context, practiceID, departmentID string) ([]emr.Encounter, error) {
	return f.encounters, f.err
}
func (f fakeEMR) ListPatientOrders(ctx context.Context, practiceID, patientID, departmentID string, orderTypes []string) ([]emr.Order, error) {
	return nil, nil
}
func (f fakeEMR) ListDepartmentPatients(ctx context.Context, practiceID, departmentID string) ([]emr.Patient, error) {
	return nil, nil
}
func (f fakeEMR) GetPatientName(ctx context.Context, practiceID, patientID string) (string, error) {
	return "", nil
}
func (f fakeEMR) ApproveOrders(ctx context.Context, practiceID string, orderIDs []string) ([]string, error) {
	return nil, nil
}
func (f fakeEMR) GetActiveDiagnoses(ctx context.Context, practiceID, patientID string) ([]emr.Diagnosis, error) {
	return nil, nil
}
func (f fakeEMR) WriteEncounterHPI(ctx context.Context, practiceID, encounterID, hpiText string) error {
	return nil
}
func (f fakeEMR) WriteEncounterAssessmentPlan(ctx context.Context, practiceID, encounterID, apText string) error {
	return nil
}
func (f fakeEMR) WriteEncounterPhysicalExam(ctx context.Context, practiceID, encounterID, peText string) error {
	return nil
}
```

- [ ] **Step 2: Write the failing test**

Add to `internal/scribe/handler_test.go`:

```go
func TestHandleListDepartments(t *testing.T) {
	h := &Handler{
		cfg: &config.Config{AthenaPracticeID: "195900"},
		emr: fakeEMR{departments: []emr.Department{{ID: "1", Name: "Primary Care"}}},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/scribe/departments", nil)
	w := httptest.NewRecorder()
	h.HandleListDepartments(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"Primary Care"`) {
		t.Errorf("expected department in body, got %s", w.Body.String())
	}
}
```

Add `"strings"` to the test imports if not already present.

- [ ] **Step 3: Run test to verify it fails**

Run: `go test ./internal/scribe/ -run TestHandleListDepartments -v`
Expected: FAIL — `h.HandleListDepartments undefined`.

- [ ] **Step 4: Implement the handler**

Add to `internal/scribe/handler.go`:

```go
type departmentResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (h *Handler) HandleListDepartments(w http.ResponseWriter, r *http.Request) {
	depts, err := h.emr.ListDepartments(r.Context(), h.cfg.AthenaPracticeID)
	if err != nil {
		log.Printf("scribe: list departments: %v", err)
		http.Error(w, "failed to list departments", http.StatusBadGateway)
		return
	}

	out := make([]departmentResponse, 0, len(depts))
	for _, d := range depts {
		out = append(out, departmentResponse{ID: d.ID, Name: d.Name})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `go test ./internal/scribe/ -run TestHandleListDepartments -v`
Expected: PASS.

- [ ] **Step 6: Mount the route**

In `internal/server/server.go`, inside the protected route group (after the existing `r.Get("/api/scribe/sessions", ...)` lines), add:

```go
		r.Get("/api/scribe/departments", s.scribeHandler.HandleListDepartments)
```

- [ ] **Step 7: Verify build**

Run: `go build ./... && go test ./internal/scribe/...`
Expected: builds clean, tests PASS.

- [ ] **Step 8: Commit**

```bash
git add internal/scribe/handler.go internal/scribe/handler_test.go internal/server/server.go
git commit -m "feat: add GET /api/scribe/departments"
```

---

## Task 5: Encounters endpoint

**Files:**
- Modify: `internal/scribe/handler.go`
- Modify: `internal/scribe/handler_test.go`
- Modify: `internal/server/server.go`

- [ ] **Step 1: Write the failing tests**

Add to `internal/scribe/handler_test.go`:

```go
func TestHandleListEncounters(t *testing.T) {
	h := &Handler{
		cfg: &config.Config{AthenaPracticeID: "195900"},
		emr: fakeEMR{encounters: []emr.Encounter{
			{ID: "900", PatientID: "55", PatientName: "Ada Lovelace", DepartmentID: "1", Date: "05/31/2026"},
		}},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/scribe/encounters?department_id=1", nil)
	w := httptest.NewRecorder()
	h.HandleListEncounters(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, `"encounter_id":"900"`) || !strings.Contains(body, `"patient_name":"Ada Lovelace"`) {
		t.Errorf("unexpected body: %s", body)
	}
}

func TestHandleListEncounters_MissingDepartment(t *testing.T) {
	h := &Handler{cfg: &config.Config{AthenaPracticeID: "195900"}, emr: fakeEMR{}}

	req := httptest.NewRequest(http.MethodGet, "/api/scribe/encounters", nil)
	w := httptest.NewRecorder()
	h.HandleListEncounters(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/scribe/ -run TestHandleListEncounters -v`
Expected: FAIL — `h.HandleListEncounters undefined`.

- [ ] **Step 3: Implement the handler**

Add to `internal/scribe/handler.go`:

```go
type encounterResponse struct {
	EncounterID  string `json:"encounter_id"`
	PatientID    string `json:"patient_id"`
	PatientName  string `json:"patient_name"`
	DepartmentID string `json:"department_id"`
	Date         string `json:"date"`
}

func (h *Handler) HandleListEncounters(w http.ResponseWriter, r *http.Request) {
	departmentID := r.URL.Query().Get("department_id")
	if departmentID == "" {
		http.Error(w, "department_id required", http.StatusBadRequest)
		return
	}

	encs, err := h.emr.ListTodayEncounters(r.Context(), h.cfg.AthenaPracticeID, departmentID)
	if err != nil {
		log.Printf("scribe: list encounters (dept=%s): %v", departmentID, err)
		http.Error(w, "failed to list encounters", http.StatusBadGateway)
		return
	}

	out := make([]encounterResponse, 0, len(encs))
	for _, e := range encs {
		out = append(out, encounterResponse{
			EncounterID:  e.ID,
			PatientID:    e.PatientID,
			PatientName:  e.PatientName,
			DepartmentID: e.DepartmentID,
			Date:         e.Date,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/scribe/ -run TestHandleListEncounters -v`
Expected: PASS.

- [ ] **Step 5: Mount the route**

In `internal/server/server.go`, after the departments route added in Task 4:

```go
		r.Get("/api/scribe/encounters", s.scribeHandler.HandleListEncounters)
```

- [ ] **Step 6: Verify build and full backend tests**

Run: `go build ./... && go test ./...`
Expected: builds clean, all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/scribe/handler.go internal/scribe/handler_test.go internal/server/server.go
git commit -m "feat: add GET /api/scribe/encounters"
```

---

## Task 6: Retire the mobile spike endpoint

**Files:**
- Delete: `internal/mobile/handler.go`, `internal/mobile/handler_test.go`
- Modify: `internal/server/server.go`, `cmd/janushc-dash/main.go`, `internal/config/config.go`

- [ ] **Step 1: Remove the route and handler wiring**

In `internal/server/server.go`:
- Delete the import `"github.com/andybarilla/janushc-dash/internal/mobile"`.
- Delete the `mobileHandler *mobile.Handler` struct field.
- Remove `mobileHandler` from the `New(...)` parameter list and the struct literal assignment.
- Delete the route block:
  ```go
  	s.router.With(middleware.Timeout(5*time.Minute)).
  		Post("/api/mobile/recordings", s.mobileHandler.HandleCreateRecording)
  ```

- [ ] **Step 2: Update main.go**

In `cmd/janushc-dash/main.go`:
- Delete the import `"github.com/andybarilla/janushc-dash/internal/mobile"`.
- Delete the line constructing `mobileHandler := mobile.NewHandler(cfg)`.
- Remove `mobileHandler` from the `server.New(...)` call.

- [ ] **Step 3: Remove config fields**

In `internal/config/config.go`, delete the `MobileSpikeToken` and `MobileRecordingsDir` struct fields and their `getEnv("MOBILE_SPIKE_TOKEN", ...)` / `getEnv("MOBILE_RECORDINGS_DIR", ...)` assignments.

- [ ] **Step 4: Delete the package**

```bash
git rm internal/mobile/handler.go internal/mobile/handler_test.go
```

- [ ] **Step 5: Verify build and tests**

Run: `go build ./... && go test ./...`
Expected: builds clean, all tests PASS, no references to `mobile` remain.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: retire /api/mobile/recordings spike endpoint"
```

---

## Task 7: App dependencies and Android OAuth config

**Files:**
- Modify: `mobile-recorder-spike/package.json`
- Modify: `mobile-recorder-spike/app.json`

- [ ] **Step 1: Add dependencies**

From `mobile-recorder-spike/`:

```bash
npx expo install @react-native-google-signin/google-signin
npm install --save-dev jest jest-expo @types/jest
```

- [ ] **Step 2: Add the test script**

In `mobile-recorder-spike/package.json`, add to `scripts`:

```json
    "test": "jest"
```

- [ ] **Step 3: Configure the google-signin plugin and OAuth client**

In `mobile-recorder-spike/app.json`, add the plugin to the `plugins` array and an `extra.googleWebClientId` value:

```json
      "@react-native-google-signin/google-signin"
```

And under `extra`:

```json
      "googleWebClientId": "REPLACE_WITH_GOOGLE_CLIENT_ID"
```

> **External prerequisite (do this before building, not a code step):** In Google Cloud, create an OAuth **Android client** for package `com.janushc.recorder.spike` with the build's signing-certificate SHA-1 (from `eas credentials` or the local keystore). The app sends the **web** client id as `webClientId`; the Android client must also exist or Google Sign-In fails at runtime. Set `extra.googleWebClientId` to the existing web `GOOGLE_CLIENT_ID` value used by the backend/web app.

- [ ] **Step 4: Verify typecheck still passes**

Run: `cd mobile-recorder-spike && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add mobile-recorder-spike/package.json mobile-recorder-spike/package-lock.json mobile-recorder-spike/app.json
git commit -m "chore(app): add google-signin + jest, configure Android OAuth"
```

---

## Task 8: API base URL config module

**Files:**
- Create: `mobile-recorder-spike/src/config.ts`

- [ ] **Step 1: Write the module**

Create `mobile-recorder-spike/src/config.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const STORAGE_KEY = 'janushc:apiBaseUrl';

const DEFAULT_API_BASE_URL =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:8080';

export const googleWebClientId =
  (Constants.expoConfig?.extra?.googleWebClientId as string | undefined) ?? '';

export async function loadApiBaseUrl(): Promise<string> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  return (stored && stored.trim()) || DEFAULT_API_BASE_URL;
}

export async function saveApiBaseUrl(value: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, value).catch(() => undefined);
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd mobile-recorder-spike && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add mobile-recorder-spike/src/config.ts
git commit -m "feat(app): API base URL config module"
```

---

## Task 9: API client with JWT and 401 handling

**Files:**
- Create: `mobile-recorder-spike/src/api.ts`

- [ ] **Step 1: Write the module**

Create `mobile-recorder-spike/src/api.ts`:

```ts
import { normalizeBaseUrl } from './config';

export type Department = { id: string; name: string };

export type Encounter = {
  encounter_id: string;
  patient_id: string;
  patient_name: string;
  department_id: string;
  date: string;
};

export type Session = {
  id: string;
  patient_id: string;
  encounter_id: string;
  department_id: string;
  status: string;
};

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

type ApiOptions = {
  baseUrl: string;
  token: string | null;
  onUnauthorized: () => void;
};

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(opts: ApiOptions, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${normalizeBaseUrl(opts.baseUrl)}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...authHeaders(opts.token) },
  });
  if (res.status === 401) {
    opts.onUnauthorized();
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

// Exchanges a Google idToken for the app JWT. Not authenticated, so it bypasses
// the shared request() helper's token handling.
export async function googleLogin(baseUrl: string, idToken: string): Promise<string> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`login failed: HTTP ${res.status} ${text}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export function listDepartments(opts: ApiOptions): Promise<Department[]> {
  return request<Department[]>(opts, '/api/scribe/departments', { method: 'GET' });
}

export function listEncounters(opts: ApiOptions, departmentId: string): Promise<Encounter[]> {
  return request<Encounter[]>(
    opts,
    `/api/scribe/encounters?department_id=${encodeURIComponent(departmentId)}`,
    { method: 'GET' },
  );
}

export function createSession(
  opts: ApiOptions,
  body: { patient_id: string; encounter_id: string; department_id: string },
): Promise<Session> {
  return request<Session>(opts, '/api/scribe/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Uploads the recorded audio to an existing session. No auto-transcribe flag is
// sent, so the backend marks the session "recording" for the web review flow.
export async function uploadAudio(opts: ApiOptions, sessionId: string, fileUri: string): Promise<void> {
  const form = new FormData();
  form.append('audio', {
    uri: fileUri,
    name: `janushc-${sessionId}.m4a`,
    type: 'audio/m4a',
  } as unknown as Blob);

  const res = await fetch(
    `${normalizeBaseUrl(opts.baseUrl)}/api/scribe/sessions/${sessionId}/upload`,
    { method: 'POST', headers: authHeaders(opts.token), body: form },
  );
  if (res.status === 401) {
    opts.onUnauthorized();
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`upload failed: HTTP ${res.status} ${text}`);
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd mobile-recorder-spike && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add mobile-recorder-spike/src/api.ts
git commit -m "feat(app): typed API client with JWT + 401 handling"
```

---

## Task 10: Upload queue state machine (pure, tested)

**Files:**
- Create: `mobile-recorder-spike/src/upload-queue.ts`
- Create: `mobile-recorder-spike/src/upload-queue.test.ts`
- Create: `mobile-recorder-spike/jest.config.js`

This isolates the create-then-upload-with-retry logic from React Native so it can be unit-tested. It tracks each recording's progress (`needs-session` → `needs-upload` → `done`) so a retry resumes at the right step.

- [ ] **Step 1: Add the Jest config**

Create `mobile-recorder-spike/jest.config.js`:

```js
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.ts'],
};
```

- [ ] **Step 2: Write the failing test**

Create `mobile-recorder-spike/src/upload-queue.test.ts`:

```ts
import { processItem, PendingItem } from './upload-queue';

function baseItem(): PendingItem {
  return {
    id: 'r1',
    fileUri: 'file:///tmp/r1.m4a',
    patientId: '55',
    encounterId: '900',
    departmentId: '1',
    sessionId: null,
    status: 'needs-session',
  };
}

test('creates a session then uploads, reaching done', async () => {
  const calls: string[] = [];
  const result = await processItem(baseItem(), {
    createSession: async () => {
      calls.push('create');
      return 'sess-1';
    },
    uploadAudio: async (sessionId) => {
      calls.push(`upload:${sessionId}`);
    },
  });

  expect(calls).toEqual(['create', 'upload:sess-1']);
  expect(result.status).toBe('done');
  expect(result.sessionId).toBe('sess-1');
});

test('skips session creation when sessionId already exists', async () => {
  const calls: string[] = [];
  const item: PendingItem = { ...baseItem(), sessionId: 'sess-1', status: 'needs-upload' };

  const result = await processItem(item, {
    createSession: async () => {
      calls.push('create');
      return 'should-not-happen';
    },
    uploadAudio: async (sessionId) => {
      calls.push(`upload:${sessionId}`);
    },
  });

  expect(calls).toEqual(['upload:sess-1']);
  expect(result.status).toBe('done');
});

test('upload failure keeps the session id for a later resume', async () => {
  const item: PendingItem = { ...baseItem() };

  const result = await processItem(item, {
    createSession: async () => 'sess-1',
    uploadAudio: async () => {
      throw new Error('network down');
    },
  });

  expect(result.status).toBe('needs-upload');
  expect(result.sessionId).toBe('sess-1');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mobile-recorder-spike && npm test`
Expected: FAIL — cannot find module `./upload-queue`.

- [ ] **Step 4: Implement the queue module**

Create `mobile-recorder-spike/src/upload-queue.ts`:

```ts
export type PendingStatus = 'needs-session' | 'needs-upload' | 'done';

export type PendingItem = {
  id: string;
  fileUri: string;
  patientId: string;
  encounterId: string;
  departmentId: string;
  sessionId: string | null;
  status: PendingStatus;
};

export type ProcessDeps = {
  createSession: (item: PendingItem) => Promise<string>;
  uploadAudio: (sessionId: string, item: PendingItem) => Promise<void>;
};

// Advances one pending recording as far as it can. On failure it returns the
// item with the furthest-reached status (and any session id) so a later retry
// resumes at the right step instead of creating a duplicate session.
export async function processItem(item: PendingItem, deps: ProcessDeps): Promise<PendingItem> {
  let sessionId = item.sessionId;

  if (!sessionId) {
    try {
      sessionId = await deps.createSession(item);
    } catch {
      return { ...item, status: 'needs-session' };
    }
  }

  try {
    await deps.uploadAudio(sessionId, item);
  } catch {
    return { ...item, sessionId, status: 'needs-upload' };
  }

  return { ...item, sessionId, status: 'done' };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile-recorder-spike && npm test`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add mobile-recorder-spike/jest.config.js mobile-recorder-spike/src/upload-queue.ts mobile-recorder-spike/src/upload-queue.test.ts
git commit -m "feat(app): tested create-then-upload queue"
```

---

## Task 11: Auth context + sign-in screen

**Files:**
- Create: `mobile-recorder-spike/src/auth.tsx`
- Create: `mobile-recorder-spike/src/screens/sign-in.tsx`

- [ ] **Step 1: Write the auth context**

Create `mobile-recorder-spike/src/auth.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { googleLogin } from './api';
import { googleWebClientId, loadApiBaseUrl } from './config';

const JWT_KEY = 'janushc:jwt';

type AuthState = {
  ready: boolean;
  token: string | null;
  baseUrl: string;
  signIn: () => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080');

  useEffect(() => {
    GoogleSignin.configure({ webClientId: googleWebClientId });
    Promise.all([
      AsyncStorage.getItem(JWT_KEY).catch(() => null),
      loadApiBaseUrl(),
    ]).then(([storedToken, storedBase]) => {
      if (storedToken) setToken(storedToken);
      setBaseUrl(storedBase);
      setReady(true);
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      token,
      baseUrl,
      async signIn() {
        await GoogleSignin.hasPlayServices();
        const userInfo = await GoogleSignin.signIn();
        const idToken = userInfo.data?.idToken;
        if (!idToken) throw new Error('no idToken returned from Google');
        const jwt = await googleLogin(baseUrl, idToken);
        await AsyncStorage.setItem(JWT_KEY, jwt);
        setToken(jwt);
      },
      signOut() {
        AsyncStorage.removeItem(JWT_KEY).catch(() => undefined);
        GoogleSignin.signOut().catch(() => undefined);
        setToken(null);
      },
    }),
    [ready, token, baseUrl],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 2: Write the sign-in screen**

Create `mobile-recorder-spike/src/screens/sign-in.tsx`:

```tsx
import { useState } from 'react';
import { Alert, Button, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth';

export function SignInScreen() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);

  async function onPress() {
    setBusy(true);
    try {
      await signIn();
    } catch (err) {
      Alert.alert('Sign-in failed', String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>JanusHC Recorder</Text>
      <Text style={styles.body}>Sign in with your JanusHC Google account to record visits.</Text>
      <Button title={busy ? 'Signing in…' : 'Sign in with Google'} onPress={onPress} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', gap: 16, padding: 24, backgroundColor: '#ffffff' },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a', textAlign: 'center' },
  body: { color: '#475569', textAlign: 'center', lineHeight: 20 },
});
```

- [ ] **Step 3: Verify typecheck**

Run: `cd mobile-recorder-spike && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add mobile-recorder-spike/src/auth.tsx mobile-recorder-spike/src/screens/sign-in.tsx
git commit -m "feat(app): Google Sign-In auth context + screen"
```

---

## Task 12: Pick-encounter screen

**Files:**
- Create: `mobile-recorder-spike/src/screens/pick-encounter.tsx`

- [ ] **Step 1: Write the screen**

Create `mobile-recorder-spike/src/screens/pick-encounter.tsx`. It loads departments on mount, loads encounters when a department is chosen, and calls `onSelect` with the chosen encounter.

```tsx
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Department, Encounter, listDepartments, listEncounters } from '../api';
import { useAuth } from '../auth';

export function PickEncounterScreen({ onSelect }: { onSelect: (e: Encounter) => void }) {
  const { token, baseUrl, signOut } = useAuth();
  const opts = { baseUrl, token, onUnauthorized: signOut };

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDepartments(opts)
      .then((d) => {
        setDepartments(d);
        if (d.length > 0) setDepartmentId(d[0].id);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadEncounters = useCallback(() => {
    if (!departmentId) return;
    setLoading(true);
    setError(null);
    listEncounters(opts, departmentId)
      .then(setEncounters)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId]);

  useEffect(loadEncounters, [loadEncounters]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Select encounter</Text>

      <View style={styles.depRow}>
        {departments.map((d) => (
          <Pressable
            key={d.id}
            onPress={() => setDepartmentId(d.id)}
            style={[styles.chip, d.id === departmentId && styles.chipActive]}
          >
            <Text style={[styles.chipText, d.id === departmentId && styles.chipTextActive]}>{d.name}</Text>
          </Pressable>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      {loading && <ActivityIndicator />}

      <FlatList
        data={encounters}
        keyExtractor={(e) => e.encounter_id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadEncounters} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>No encounters today.</Text> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onSelect(item)}>
            <Text style={styles.rowName}>{item.patient_name || item.patient_id}</Text>
            <Text style={styles.rowMeta}>{item.date}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12, backgroundColor: '#ffffff' },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  depRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: '#166534', borderColor: '#166534' },
  chipText: { color: '#0f172a' },
  chipTextActive: { color: '#ffffff' },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  rowName: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  rowMeta: { color: '#64748b', marginTop: 2 },
  empty: { color: '#64748b', paddingVertical: 24, textAlign: 'center' },
  error: { color: '#b91c1c' },
});
```

- [ ] **Step 2: Verify typecheck**

Run: `cd mobile-recorder-spike && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add mobile-recorder-spike/src/screens/pick-encounter.tsx
git commit -m "feat(app): pick-encounter screen"
```

---

## Task 13: Record screen

**Files:**
- Create: `mobile-recorder-spike/src/screens/record.tsx`

This carries over the spike's proven recording core (expo-av, background audio mode, keep-awake, duration timer, consent gate) and, on stop, hands the recording to the upload queue.

- [ ] **Step 1: Write the screen**

Create `mobile-recorder-spike/src/screens/record.tsx`:

```tsx
import { Audio } from 'expo-av';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, StyleSheet, Switch, Text, View } from 'react-native';
import { createSession, Encounter, uploadAudio } from '../api';
import { useAuth } from '../auth';
import { PendingItem, processItem } from '../upload-queue';

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((p) => String(p).padStart(2, '0')).join(':');
}

export function RecordScreen({ encounter, onDone }: { encounter: Encounter; onDone: () => void }) {
  const { token, baseUrl, signOut } = useAuth();
  const opts = { baseUrl, token, onUnauthorized: signOut };
  const recordingRef = useRef<Audio.Recording | null>(null);

  const [consent, setConsent] = useState(false);
  const [keepAwake, setKeepAwake] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [durationMillis, setDurationMillis] = useState(0);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
    }).catch(console.warn);
  }, []);

  async function startRecording() {
    if (!consent) {
      Alert.alert('Consent required', 'Confirm patient consent before recording.');
      return;
    }
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Microphone permission denied');
      return;
    }
    if (keepAwake) await activateKeepAwakeAsync('janushc-recorder');

    const recording = new Audio.Recording();
    recording.setOnRecordingStatusUpdate((status) => {
      if (status.isRecording || status.durationMillis > 0) setDurationMillis(status.durationMillis);
    });
    recording.setProgressUpdateInterval(1000);
    await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await recording.startAsync();
    recordingRef.current = recording;
    setIsRecording(true);
  }

  async function stopRecording() {
    const recording = recordingRef.current;
    if (!recording) return;
    await recording.stopAndUnloadAsync();
    deactivateKeepAwake('janushc-recorder');
    const uri = recording.getURI();
    recordingRef.current = null;
    setIsRecording(false);
    if (!uri) {
      Alert.alert('No recording URI returned');
      return;
    }
    await upload(uri);
  }

  async function upload(fileUri: string) {
    setUploading(true);
    const item: PendingItem = {
      id: encounter.encounter_id,
      fileUri,
      patientId: encounter.patient_id,
      encounterId: encounter.encounter_id,
      departmentId: encounter.department_id,
      sessionId: null,
      status: 'needs-session',
    };
    const result = await processItem(item, {
      createSession: async (it) =>
        (await createSession(opts, {
          patient_id: it.patientId,
          encounter_id: it.encounterId,
          department_id: it.departmentId,
        })).id,
      uploadAudio: async (sessionId) => uploadAudio(opts, sessionId, fileUri),
    });
    setUploading(false);

    if (result.status === 'done') {
      Alert.alert('Uploaded', 'Recording sent to the scribe inbox.');
      onDone();
    } else {
      Alert.alert(
        'Upload incomplete',
        'The recording is saved on this device. Retry?',
        [
          { text: 'Later', style: 'cancel', onPress: onDone },
          { text: 'Retry', onPress: () => retry(result) },
        ],
      );
    }
  }

  async function retry(prev: PendingItem) {
    setUploading(true);
    const result = await processItem(prev, {
      createSession: async (it) =>
        (await createSession(opts, {
          patient_id: it.patientId,
          encounter_id: it.encounterId,
          department_id: it.departmentId,
        })).id,
      uploadAudio: async (sessionId) => uploadAudio(opts, sessionId, prev.fileUri),
    });
    setUploading(false);
    if (result.status === 'done') {
      Alert.alert('Uploaded', 'Recording sent to the scribe inbox.');
      onDone();
    } else {
      Alert.alert('Still failing', 'Try again from a better connection.', [
        { text: 'Later', style: 'cancel', onPress: onDone },
        { text: 'Retry', onPress: () => retry(result) },
      ]);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.patient}>{encounter.patient_name || encounter.patient_id}</Text>
      <Text style={styles.meta}>Encounter {encounter.encounter_id}</Text>

      <View style={styles.row}>
        <Text style={styles.body}>Consent confirmed</Text>
        <Switch value={consent} onValueChange={setConsent} disabled={isRecording} />
      </View>
      <View style={styles.row}>
        <Text style={styles.body}>Keep screen awake</Text>
        <Switch value={keepAwake} onValueChange={setKeepAwake} disabled={isRecording} />
      </View>

      <Text style={styles.timer}>{formatDuration(durationMillis)}</Text>

      {uploading ? (
        <Text style={styles.body}>Uploading…</Text>
      ) : (
        <Button
          title={isRecording ? 'Stop & upload' : 'Start recording'}
          color={isRecording ? '#b91c1c' : '#166534'}
          onPress={isRecording ? stopRecording : startRecording}
        />
      )}

      {!isRecording && !uploading && <Button title="Back to encounters" onPress={onDone} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16, backgroundColor: '#ffffff' },
  patient: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  meta: { color: '#64748b' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  body: { color: '#1e293b' },
  timer: { fontSize: 48, textAlign: 'center', fontVariant: ['tabular-nums'], color: '#0f172a' },
});
```

- [ ] **Step 2: Verify typecheck**

Run: `cd mobile-recorder-spike && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add mobile-recorder-spike/src/screens/record.tsx
git commit -m "feat(app): record screen with resilient upload"
```

---

## Task 14: App shell wiring everything together

**Files:**
- Rewrite: `mobile-recorder-spike/App.tsx`

- [ ] **Step 1: Replace App.tsx**

Replace the entire contents of `mobile-recorder-spike/App.tsx` with:

```tsx
import Constants from 'expo-constants';
import { useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { Encounter } from './src/api';
import { AuthProvider, useAuth } from './src/auth';
import { PickEncounterScreen } from './src/screens/pick-encounter';
import { RecordScreen } from './src/screens/record';
import { SignInScreen } from './src/screens/sign-in';

function Root() {
  const { ready, token } = useAuth();
  const [selected, setSelected] = useState<Encounter | null>(null);

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!token) return <SignInScreen />;
  if (selected) return <RecordScreen encounter={selected} onDone={() => setSelected(null)} />;
  return <PickEncounterScreen onSelect={setSelected} />;
}

export default function App() {
  return (
    <View style={styles.app}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <AuthProvider>
        <Root />
      </AuthProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, paddingTop: Constants.statusBarHeight, backgroundColor: '#ffffff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ffffff' },
});
```

- [ ] **Step 2: Verify typecheck and tests**

Run: `cd mobile-recorder-spike && npm run typecheck && npm test`
Expected: typecheck clean, queue tests PASS.

- [ ] **Step 3: Commit**

```bash
git add mobile-recorder-spike/App.tsx
git commit -m "feat(app): wire sign-in → pick-encounter → record shell"
```

---

## Task 15: Final verification

- [ ] **Step 1: Backend build + tests**

Run: `go build ./... && go test ./...`
Expected: all PASS.

- [ ] **Step 2: App typecheck + tests**

Run: `cd mobile-recorder-spike && npm run typecheck && npm test`
Expected: clean + PASS.

- [ ] **Step 3: Confirm the spike endpoint is gone**

Run: `grep -rn "api/mobile/recordings\|MOBILE_SPIKE_TOKEN\|internal/mobile" --include="*.go" .`
Expected: no matches.

- [ ] **Step 4: Manual device check (requires the external OAuth prerequisite from Task 7)**

Build a dev/preview APK, sign in with a JanusHC Google account, pick a department + encounter, record a short clip, stop. Confirm the session appears in the web scribe inbox as `recording` with the correct patient and encounter id.
