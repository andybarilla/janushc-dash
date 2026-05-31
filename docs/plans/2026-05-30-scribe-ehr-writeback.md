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

### Phase 3 — the two gaps — DECIDED + backend done
- **labs: reference-only, dropped from send gate.** Added `requiredSendSections = [hpi, plan, exam]`; `allSectionsReadyToSend` checks only those. labs stays editable/approvable for the provider but no longer blocks send and is not written to the EHR. Order entry deferred.
- **Partial-write: mark-sent-after + idempotent retry.** `HandleSend` now writes to athena first, then marks sent only on success. A failed send leaves the session unmarked and retryable; the section writes are idempotent (`replace`), so a retry re-PUTs safely. Up-front `SentToEhrAt.Valid → 409` blocks re-sending a succeeded session. Concurrent first-sends both write idempotently; one wins the mark (0-rows is treated as success). Safety depends on `replace` actually replacing — on the Phase 4 list.

**Decision A frontend — DONE.** Added `REQUIRED_SEND_SECTIONS = [hpi, plan, exam]` + `isReadyToSend()` to `status.ts` (mirrors backend). `review-screen.tsx` and mobile `detail-view.tsx` now gate Send on `isReadyToSend` instead of `approvedCount === 4`; labs stays approvable but optional. Approval pips still show all 4. Component tests + full `npm run build` green.

### Phase 4 — sandbox end-to-end — DONE
Validated against sandbox practice 195900, patient 1, OPEN encounter 64097 (patient 1 already has many OPEN encounters — no booking/check-in needed). Wrote lorem ipsum to assessment/hpi/physicalexam and read back:
- GET response shapes match the code's models: hpi → `{hpi[], templatedata[], templates[], hpitoros}`; physicalexam → `{physicalexam[], templatedata[], templates}`; assessment → `{}`/`{assessmenttext}`.
- Boolean form values: `"true"` accepted for `replacetext`/`replacesectionnote` (NOT "yes/no"). Code already uses `"true"`. ✓
- A&P maps to the single `/assessment` section (`assessmenttext`). ✓
- `replace` is idempotent: re-PUT of the same note left `sectionnote` unchanged (no append/dup) — confirms the retry-safety the send flow relies on. ✓
- All three section notes read back with the exact written text. ✓

**Un-exercised:** PE `templateid` extraction (encounter had empty `templatedata`, so no attached templates to preserve) and non-empty `hpi` array echo-preservation. Both only matter on encounters with pre-existing structured findings; the write path itself is confirmed. No code changes were required — implementation matched the live API.

## Test environment
Local Postgres on `localhost:5433` (off prod Supabase). `go test ./...` for backend.
