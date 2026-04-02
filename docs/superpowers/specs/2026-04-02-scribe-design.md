# Scribe — Visit Documentation Automation

## Overview

Automate clinical documentation for patient visits by recording doctor-patient conversations, transcribing them, and writing structured encounter data directly into athenahealth. Replaces the work currently done by a medical assistant — the doctor's review and sign-off workflow in athenaOne remains unchanged.

## Problem

Hour-long visits (including therapy-adjacent hormone consultations) require detailed clinical notes. Notes pile up and get done after hours ("pajama time charting"), causing burnout. Currently, a medical assistant manually enters encounter data into athena based on what happens during the visit.

## Approach: Direct-to-Athena

The AI scribe replaces the MA's documentation work. There is no intermediate review UI in our application — the structured output is written directly to athena's encounter fields via API, and the doctor reviews and signs off in athenaOne as she does today.

This keeps the doctor's workflow unchanged and avoids introducing an extra review step.

## Recording Scenarios

- **In-person visits:** Chromebook in exam room with a mic, browser-based recorder
- **Telehealth:** Chrome browser captures audio
- **Both cases:** Doctor starts and stops recording. Audio captured via MediaRecorder API in the browser.

## Processing Pipeline

The pipeline is designed in two layers so that the core processing logic (transcript → Claude → athena) can be developed and tested independently of the real-time recording infrastructure.

### Core Processing Layer

Accepts a transcript (or audio file for batch transcription) and produces structured encounter data:

1. **Input:** Transcript text (with optional speaker diarization labels)
2. **Context fetch:** Pull patient's active diagnoses from athena (needed for Physical Exam pre-population)
3. **AI processing:** Send transcript + patient context to Claude via Bedrock
4. **Output:** Four structured sections (see AI Output Sections below)
5. **Athena write:** Write each section to the appropriate athena encounter field via API

This layer is the first thing built. Early development and testing uses manually recorded sessions — pre-recorded audio files transcribed via batch Transcribe Medical, or raw transcript text fed directly into the pipeline.

### Real-Time Recording Layer (built on top)

Adds live recording and streaming transcription:

1. Browser captures audio via MediaRecorder API
2. Audio streams to Go backend via WebSocket
3. Backend streams to AWS Transcribe Medical (real-time streaming API)
4. Transcript accumulates with speaker diarization
5. On stop: completed transcript handed to the core processing layer

### Audio Resilience

- Audio buffered locally in the browser during streaming as a safety net
- If WebSocket drops, buffered audio replays on reconnect
- If session is unrecoverable, local buffer uploaded for batch transcription
- After successful processing and athena write, local buffer cleared
- Audio is never persisted server-side
- Accepted tradeoff: if browser crashes AND WebSocket was down, that segment is lost — doctor re-dictates or types manually

## AI Output Sections

Claude processes the full transcript in a single call and produces four structured sections:

### HPI (History of Present Illness)

- Free-form text summary of the patient's current status, complaints, and what was discussed during the visit
- Source: transcript
- Written to athena's HPI encounter field

### A/P (Assessment & Plan)

- Numbered list of the doctor's decisions and actions
- Includes labs and diagnoses extracted from the conversation (merged from Dx/Labs processing)
- Source: transcript + Dx/Labs merge
- Written to athena's A/P encounter field

### Physical Exam

- Structured by body system (respiratory, cardiovascular, musculoskeletal, etc.)
- Marks systems as normal based on what the doctor describes (e.g., "lungs sound good" → respiratory normal)
- Pre-populated from active diagnoses: findings the doctor wouldn't verbalize are included automatically (e.g., obesity from BMI in active diagnoses)
- Guard rail: never marks a finding as normal if active diagnoses indicate an abnormality
- Source: transcript + active diagnoses from athena
- Written to athena's physical exam encounter fields

### Diagnosis / Labs

- Extracts labs being ordered and diagnoses being addressed from the conversation
- Lab-to-ICD code matching for insurance coverage is deferred (future: NCD database import, potentially athena's built-in mappings)
- Merged into the A/P section for the athena write
- Source: transcript

## Claude Prompt Design

- Single prompt processes the full transcript and outputs all four sections
- Prompt includes: transcript text, speaker labels (if available), patient's active diagnoses, encounter context
- Specialty-specific context: hormone treatment protocols, common medications, dosage patterns
- Prompt must handle gracefully: noisy or missing speaker labels, single-mic diarization artifacts
- Handles long sessions: ~8-10k words per hour of conversation, well within context limits
- Template system for customizable note formats (physician's preferred style)
- Tuned over time based on physician feedback

## Session Flow (Doctor's Perspective)

1. Select patient/encounter (from athena's schedule or manual selection)
2. Click Record — audio streams, minimal UI shows recording indicator and elapsed time
3. Visit happens naturally — doctor focuses on patient
4. Click Stop — brief processing spinner
5. Done — doctor moves on. Reviews and signs the encounter in athenaOne on her own schedule.

## UI

Minimal. The scribe page in our app is a control surface, not a documentation tool:

- Patient/encounter selector
- Record / Stop button
- Status indicator (recording, processing, complete, error)
- Session history (past sessions with status, links to transcripts for debugging/regeneration)

## Data Model

Single table. Athena is the system of record.

### `scribe_sessions`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenant_id | UUID | FK to tenants |
| user_id | UUID | FK to users (the doctor) |
| patient_id | TEXT | Athena patient ID |
| encounter_id | TEXT | Athena encounter ID |
| department_id | TEXT | Athena department ID |
| status | TEXT | recording, processing, complete, error |
| transcript | TEXT | Full diarized transcript (encrypted) |
| ai_output | JSONB | Structured sections Claude produced (for debugging/regeneration) |
| error_message | TEXT | Error details if status is error |
| started_at | TIMESTAMPTZ | When recording started |
| stopped_at | TIMESTAMPTZ | When recording stopped |
| completed_at | TIMESTAMPTZ | When athena write finished |
| created_at | TIMESTAMPTZ | Row creation time |

Indexes: `(tenant_id, created_at)`, `(tenant_id, patient_id)`, `(tenant_id, status)`

## API Endpoints

```
POST   /api/scribe/sessions                  # Create session (selects patient/encounter)
PATCH  /api/scribe/sessions/:id              # Update status (start/stop recording)
GET    /api/scribe/sessions                  # List sessions (with filters)
GET    /api/scribe/sessions/:id              # Get session details + transcript
POST   /api/scribe/sessions/:id/process      # Trigger processing (for manual/test sessions)
WS     /api/scribe/sessions/:id/stream       # WebSocket for real-time audio streaming
```

The `/process` endpoint enables testing with manually recorded sessions — submit transcript text in the request body and trigger the core processing pipeline without the real-time recording layer. For audio files, transcribe externally (via AWS console or CLI) and submit the resulting transcript.

## Error Handling

- **WebSocket drops during recording:** Browser buffer keeps capturing, reconnects and replays. Status shows "reconnecting..."
- **Transcribe Medical fails:** Fall back to batch transcription of browser's audio buffer
- **Claude produces bad output:** Log raw response, set session status to error, doctor can retry. Transcript preserved for manual use or regeneration.
- **Athena API write fails:** Queue with retry. Session shows "pending sync" status. Doctor notified if stuck.
- **Browser crash during recording:** Accepted loss. Doctor re-dictates or types manually in athena.

## Dependencies

- AWS Transcribe Medical (real-time streaming API + batch API)
- AWS Bedrock (Claude) — already integrated
- Athena API encounter/chart write endpoints — need to verify exact field APIs for HPI, A/P, Physical Exam, and Diagnosis/Labs

## Deferred

- **Coverage database (NCD/insurance lab-to-ICD matching):** Separate roadmap item. For now, labs and diagnoses are extracted and written without automated coverage matching.
- **Two-pane review UI:** Original spec included transcript-on-left, note-on-right. Not needed with direct-to-athena approach — doctor reviews in athenaOne.

## Testing Strategy

Early development uses manually recorded visit audio (or raw transcripts) fed through the core processing layer. This allows iterating on:

- Claude prompt quality and output structure
- Athena API field mapping
- Physical exam pre-population logic
- End-to-end pipeline reliability

Real-time recording and WebSocket streaming are layered on after the core pipeline is validated.
