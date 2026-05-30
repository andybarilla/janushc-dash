# Scribe → EHR write-back

Implement and correct the path that writes reviewed scribe notes (HPI, Assessment & Plan, Physical Exam) into athenahealth encounters. Endpoints verified at docs.athenahealth.com/api/workflows/adding-notes-to-an-encounter (see `docs/athena-tech-spec-draft.md`).

## Current path

`HandleCreate` (encounter_id supplied by client) → `HandleUpload`/`processSessionAsync` (Transcribe Medical) → `processor.Process` (Bedrock → `ScribeOutput{HPI, AssessmentPlan, PhysicalExam, DiagnosesLabs}`) → provider edits (`scribe_section_edits`) + approves (`scribe_section_approvals`) → `HandleSend` → `MarkScribeSessionSent` → `WriteToAthena` → `WriteEncounter*` (currently stubs).

UI sections (`sectionKeys`): `hpi, plan, exam, labs` → `ScribeOutput.{HPI, AssessmentPlan, PhysicalExam, DiagnosesLabs}`.

## Findings

1. **Edits dropped on send (correctness bug).** `HandleSend` (handler.go:1269-1272) writes raw `session.AiOutput`; it loads `editRows` only for the readiness check, never for content. Provider corrections never reach the EHR. `buildDetailSections` already does the correct edit-else-AI merge for display. Athena-independent; testable on local DB.
2. **GET-then-PUT or data loss.** HPI and Physical Exam require GET the section, echo the full returned array/template back in the PUT (notes in `sectionnote`), or existing provider documentation is deleted. Assessment is a plain PUT (`assessmenttext` + replace flag).
3. **`labs` gates send but is never written.** All four sections must be approved to send; `WriteToAthena` writes only 3. `DiagnosesLabs` reaches no endpoint. Decision required.
4. **Partial-write vs sent-gate.** `MarkScribeSessionSent` runs before the writes; section writes are sequential with accumulated errors. HPI ok + PE fail → chart has HPI, session marked sent, gate blocks retry.

## Plan

### Phase 1 — fix edit-merge (no athena; local DB + TDD) — independently shippable
- Add `effectiveOutput(aiOutput []byte, editRows []database.GetSessionSectionEditsRow) ScribeOutput`: start from AI output, override per-section from latest edit (`hpi/plan/exam`=JSON string, `labs`=`[]DiagnosisLab`). Reuse the mapping logic that `buildDetailSections`/`sectionContentFromAI` already encode.
- `HandleSend`: build effective output from `session.AiOutput` + `editRows` (already loaded at 1239), pass to `WriteToAthena`.
- Tests: unit test `effectiveOutput` (edited section overrides AI, unedited falls back, labs array merges, malformed edit falls back to AI). Failing test first.

### Phase 2 — implement athena writes (`internal/emr/athena/encounters.go`) — DONE (pending sandbox validation)
- `doForm` helper added to `client.go` (form-urlencoded writes).
- `WriteEncounterAssessmentPlan` → `PUT .../assessment`, form `assessmenttext` + `replacetext`.
- `WriteEncounterHPI` → GET `.../hpi?showstructured=true`, PUT form `sectionnote` + echoed `hpi` array + `replacesectionnote`.
- `WriteEncounterPhysicalExam` → GET `.../physicalexam?showstructured=true`, PUT form `sectionnote` + `templateids` (extracted from `templatedata`) + `replacesectionnote`.
- `putEncounterSection` surfaces athena's `success`/`errormessage` envelope as Go errors.
- httptest unit tests pass: GET-before-PUT ordering, array/template echo-back (anti-wipe), error surfacing.
- **Must confirm against sandbox (Phase 4) before trusting a real write:**
  - Boolean form value format — used `"true"`; workflow doc said assessment's `replacetext` takes "yes/no". Verify athena accepts `true`/`false`.
  - PE `templatedata` id field name — assumed `templateid`; confirm against a real GET response.
  - Whether scribe's combined A&P maps to the single `/assessment` section (docs list both "Assessment" and "Assessment and Plan").
  - `replacesectionnote=true` replaces the section note (chosen for retry idempotency) — confirm this is the desired behavior vs append, and that it does not clobber provider-typed section notes.

### Phase 3 — decide the two gaps
- `labs`: write to a real endpoint (orders/problems — out of currently verified scope) or stop gating send on it.
- Partial-write: per-section sent tracking, or rely on GET-then-PUT being idempotent to allow retry. Reconsider the mark-sent-before-write ordering now that writes are real.

### Phase 4 — sandbox end-to-end
- Lorem ipsum content against an OPEN sandbox encounter (the one external dependency). Prereq: a checked-in sandbox patient with a writable `encounterid`.

## Test environment
Local Postgres on `localhost:5433` (off prod Supabase). `go test ./...` for backend.
