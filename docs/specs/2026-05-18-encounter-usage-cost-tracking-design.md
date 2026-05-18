# Encounter Usage & Cost Tracking Design

## Summary

Add per-encounter usage and cost visibility for Janus Scribe sessions. The first implementation will record estimated costs immediately for:

- Amazon Transcribe Medical batch transcription, measured in audio minutes.
- Bedrock/Anthropic LLM extraction, measured in input and output tokens.

The design stores usage at the service-call/event level so the UI can show encounter totals now and the data model can later accept reconciled AWS billed cost without replacing historical usage records.

## Goals

- Track usage and estimated cost per scribe encounter.
- Show the information in a separate **Usage & Cost** area in the encounter detail UI.
- Capture enough raw units to recalculate or audit costs later.
- Preserve a path for later AWS Cost Explorer / CUR reconciliation with actual billed cost.
- Keep PHI out of usage metadata.

## Non-goals

- Building AWS Cost Explorer or Cost and Usage Report ingestion now.
- Guaranteeing exact AWS invoice parity in the first release.
- Showing practice-wide/monthly billing dashboards.
- Charging customers or enforcing quotas.

## Current State

- `scribe_sessions` stores encounter identity, transcript, AI output, status, timestamps, and send/reject metadata.
- Audio upload starts an async batch Transcribe Medical job in `internal/scribe/handler.go`.
- The batch transcript JSON is downloaded and converted to text in `internal/transcribe/batch.go`.
- `Processor.Process` calls `bedrock.Client.Complete` for structured extraction.
- `bedrock.Client.Complete` currently returns only text and discards the Anthropic `usage` block.
- Encounter detail APIs do not expose usage or costs.

## Design Alternatives

### Option A — Add columns to `scribe_sessions`

Add transcription minutes, token counts, and costs directly to the session row.

**Pros**
- Simple queries.
- Easy UI mapping.

**Cons**
- Poor fit for future multiple LLM calls per encounter.
- Harder to reconcile individual provider events later.
- Session table becomes a wide billing table.

### Option B — One `scribe_session_usage` row per encounter

Create a 1:1 aggregate table with transcription and LLM fields.

**Pros**
- Keeps usage outside the core session row.
- Easy UI mapping.

**Cons**
- Still assumes one transcription and one LLM call.
- Actual-cost reconciliation has less event-level detail.

### Option C — Event-level usage table, aggregated for UI

Create `scribe_usage_events` with one row per provider call: transcription, LLM extraction, and future calls.

**Pros**
- Supports future multiple LLM calls.
- Supports event-level actual-cost reconciliation.
- Stores raw units and rate snapshots for auditability.
- Keeps cost tracking independent from session lifecycle fields.

**Cons**
- Slightly more query/API aggregation work.

## Recommendation

Use **Option C: event-level usage table**. It is the best fit for “estimated now, actual later” and for likely future additions such as note refinement, feedback-aware regeneration, coding assistance, or multiple LLM extraction passes.

## Data Model

Add migration `015_scribe_usage_events`.

```sql
CREATE TABLE scribe_usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES scribe_sessions(id) ON DELETE CASCADE,

    event_type TEXT NOT NULL CHECK (event_type IN ('transcription', 'llm')),
    provider TEXT NOT NULL,
    operation TEXT NOT NULL,
    model_id TEXT,
    external_job_id TEXT,

    audio_duration_seconds NUMERIC(12,3),
    billable_duration_seconds INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,

    estimated_cost_micros BIGINT NOT NULL DEFAULT 0,
    actual_cost_micros BIGINT,
    currency TEXT NOT NULL DEFAULT 'USD',
    pricing_source TEXT NOT NULL DEFAULT 'configured_rate',
    rate_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scribe_usage_events_session ON scribe_usage_events (session_id, created_at);
CREATE INDEX idx_scribe_usage_events_external_job ON scribe_usage_events (provider, external_job_id)
    WHERE external_job_id IS NOT NULL;
```

### Field notes

- `estimated_cost_micros` and `actual_cost_micros` store USD millionths to avoid floating-point money math.
- `rate_snapshot` stores the configured rates used at the time of estimation, for example:
  - Transcribe: `{ "usd_per_minute": "0.024" }`
  - LLM: `{ "input_usd_per_million_tokens": "3.00", "output_usd_per_million_tokens": "15.00" }`
- `metadata` may contain non-PHI operational details such as media format, AWS region, or transcript parser version.
- Do not store transcript text, prompts, model output, patient identifiers, or encounter identifiers in usage metadata.

## Pricing Configuration

Add configurable pricing values to `internal/config.Config`:

- `TRANSCRIBE_MEDICAL_USD_PER_MINUTE`
- `BEDROCK_INPUT_USD_PER_MILLION_TOKENS`
- `BEDROCK_OUTPUT_USD_PER_MILLION_TOKENS`

Defaults can reflect the current deployed model and AWS region at implementation time, but must be overridable by environment variables. The UI should label values as **Estimated** unless `actual_cost_micros` is populated.

### Cost calculation rules

Use deterministic helper functions for all estimates:

- Transcription:
  - `billable_duration_seconds = ceil(audio_duration_seconds)` for v1.
  - `estimated_cost_micros = round((billable_duration_seconds / 60) * transcribe_usd_per_minute * 1_000_000)`.
- LLM:
  - `input_cost_micros = round((input_tokens / 1_000_000) * input_usd_per_million_tokens * 1_000_000)`.
  - `output_cost_micros = round((output_tokens / 1_000_000) * output_usd_per_million_tokens * 1_000_000)`.
  - `estimated_cost_micros = input_cost_micros + output_cost_micros`.

If AWS provider-specific minimum billing increments are confirmed later, update the helper in one place and preserve existing rows via `rate_snapshot`.

## Backend Flow

### Transcription usage

In `processSessionAsync`:

1. Start Transcribe Medical batch job as today.
2. Wait for completion as today.
3. Download transcript JSON as today.
4. Parse both:
   - readable transcript text
   - audio duration from the maximum pronunciation item `end_time` in the Transcribe JSON
5. Calculate:
   - `audio_duration_seconds`
   - `billable_duration_seconds` using conservative rounding from measured duration
   - `estimated_cost_micros = billable_seconds / 60 * configured_transcribe_rate`
6. Insert a `scribe_usage_events` row:
   - `event_type = 'transcription'`
   - `provider = 'aws_transcribe_medical'`
   - `operation = 'medical_batch_transcription'`
   - `external_job_id = jobName`
   - `model_id = NULL`

If duration cannot be parsed, still create a usage event with provider/job metadata and zero estimated cost, plus a metadata warning. The UI should display usage as unavailable instead of failing the encounter detail view.

### LLM usage

Change Bedrock completion to preserve usage metadata:

```go
type CompletionResult struct {
    Text         string
    ModelID      string
    InputTokens  int32
    OutputTokens int32
}
```

Anthropic Bedrock Messages responses include:

```json
{
  "content": [{"text": "..."}],
  "usage": {
    "input_tokens": 123,
    "output_tokens": 456
  }
}
```

`Processor.Process` should return both the parsed `ScribeOutput` and LLM usage/cost details, for example:

```go
type ProcessResult struct {
    Output ScribeOutput
    Usage  LLMUsage
}
```

After successful AI extraction, insert a `scribe_usage_events` row:

- `event_type = 'llm'`
- `provider = 'aws_bedrock_anthropic'`
- `operation = 'scribe_extraction'`
- `model_id = cfg.BedrockModelID`
- `input_tokens`, `output_tokens`, `total_tokens`
- estimated cost calculated from configured input/output token rates

Record the usage event after the Bedrock call returns, not after parse success. This ensures usage is stored when the LLM call succeeds but JSON parsing fails. The processor should expose the completion usage separately from parse success, for example by returning a typed error that carries `LLMUsage` or by splitting completion and parsing inside the async handler. Mark the session errored if parsing fails, but still persist the billable LLM usage event when usage is available.

## SQLC Queries

Add `queries/scribe_usage.sql`:

- `CreateScribeUsageEvent`
- `ListScribeUsageEventsForSession`
- `GetScribeUsageSummaryForSession`

The summary query should aggregate per session:

- transcription duration seconds summed across transcription events
- transcription billable seconds summed across transcription events
- transcription estimated/actual cost micros summed across transcription events
- LLM input/output/total tokens summed across LLM events
- LLM estimated/actual cost micros summed across LLM events
- total estimated/actual cost micros
- event count

The v1 API presents aggregated `transcription` and `llm` summary objects rather than a raw event list. If future UI needs per-call detail, add a separate event-list endpoint without changing the stored data model.

`GetScribeSession` can either join summary fields directly or the handler can call a separate summary query after loading the session. Prefer a separate summary query to avoid making every session query billing-aware.

## API Contract

Extend `GET /api/scribe/sessions/{id}` response with optional usage data:

```ts
usage?: {
  transcription?: {
    provider: string;
    operation: string;
    audio_duration_seconds?: number;
    billable_duration_seconds?: number;
    estimated_cost_micros: number;
    actual_cost_micros?: number;
    currency: "USD";
  };
  llm?: {
    provider: string;
    operation: string;
    model_id?: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_micros: number;
    actual_cost_micros?: number;
    currency: "USD";
  };
  total_estimated_cost_micros: number;
  total_actual_cost_micros?: number;
  currency: "USD";
  cost_basis: "estimated" | "actual" | "mixed";
}
```

Do not expose raw `rate_snapshot` or operational metadata in the UI API unless needed later for admin/debug screens.

For aggregated display fields (`provider`, `operation`, `model_id`), use the shared value when all aggregated events match. If multiple values are present, return `"multiple"` for provider/operation and omit `model_id` unless all LLM events used the same model. Cost basis should be derived from the displayed events: `actual` only when all displayed event costs have actual values, `mixed` when some do, and `estimated` when none do.

## UI Design

Add a separate **Usage & Cost** card to encounter detail views.

### Desktop placement

In `frontend/src/components/scribe/detail-view.tsx`, place the card after the audio strip / pipeline progress and before clinical sections. This keeps it separate from medical note content while still visible in the encounter workflow.

### Mobile placement

In `frontend/src/components/scribe-mobile/detail-view.tsx`, place a compact card after the audio strip / pipeline tracker and before approval/section cards.

### Card content

When usage exists:

- Header: `Usage & Cost`
- Small label: `Estimated` unless actual/mixed values exist
- Transcription row:
  - `Amazon Transcribe Medical`
  - `12.4 min audio`
  - `$0.30 est.`
- AI extraction row:
  - model display name, or raw model ID if no display mapping exists
  - `8,120 in / 1,024 out tokens`
  - `$0.04 est.`
- Total row:
  - `Total estimated encounter cost`
  - `$0.34`

When usage is absent but the encounter is in pipeline:

- Show a muted placeholder: `Usage will appear after transcription and AI extraction complete.`

When usage is absent and the encounter is failed:

- Show whatever partial usage is available. If no usage exists: `No usage captured for this failed run.`

### Formatting helpers

Add frontend helpers for:

- dollars from micros
- minutes from seconds
- token counts with locale formatting
- model ID display names

## Actual Cost Reconciliation Path

No reconciliation job is included now, but the event table supports it later:

- Match Transcribe events by `external_job_id` and time window.
- Match Bedrock events by provider/model/operation/time window, or by request ID if captured later.
- Populate `actual_cost_micros` and update `pricing_source` / metadata.
- UI `cost_basis` becomes `actual` when all displayed events have actual costs, `mixed` when some do, and `estimated` otherwise.

## Error Handling

- Usage tracking must not block successful clinical processing.
- If usage insert fails, log the error and continue the pipeline.
- If usage parsing fails, store the rest of the event when possible and include non-PHI warning metadata.
- Encounter detail responses should not fail if usage summary loading fails; log and omit usage.

## Security & Privacy

- Usage tables contain operational and cost data only.
- Do not store prompts, transcript text, AI output, patient names, patient IDs, or encounter IDs in usage event metadata.
- Access is inherited through session tenant checks. API handlers only expose usage for sessions already authorized by `tenant_id`.

## Testing Plan

### Backend

- Unit test Bedrock response parsing for `usage.input_tokens` and `usage.output_tokens`.
- Unit test cost calculations:
  - transcription seconds to billable seconds/minutes/cost micros
  - LLM input/output tokens to cost micros
- Unit test transcript JSON duration extraction from `end_time` fields.
- Handler/processor tests should confirm usage summary is included when query rows exist and omitted safely when absent.
- Run `make sqlc` after adding queries.
- Run `go test ./...`.

### Frontend

- Unit test formatting helpers.
- Component test `UsageCostCard` for:
  - estimated only
  - mixed/actual labels
  - missing usage placeholder
- Run `cd frontend && npm run build`.

## Acceptance Criteria

- Each completed scribe encounter records a transcription usage event with audio duration and estimated cost when duration is available.
- Each completed LLM extraction records token counts and estimated cost.
- Encounter detail API returns a usage summary for authorized users.
- Desktop and mobile encounter detail screens show a separate **Usage & Cost** section.
- The UI clearly labels costs as estimated unless actual costs are available.
- Usage tracking failures do not break transcription, extraction, or note review workflows.
- Raw usage units are stored so costs can be recalculated or reconciled later.
