# emrai — Physician Workflow Automation Platform

## Overview

emrai is a web-based platform that automates repetitive clinical and administrative workflows for independent physician practices, starting with athenahealth (athenaOne) EMR integration. The initial deployment serves a solo general practice focused on women's and trans health / hormone treatments.

**Primary goal:** Reduce physician and staff workload, save money.
**Secondary goal:** Build a monetizable product for other independent practices.

## Problem Statement

The target practice has four major pain points, in priority order:

1. **Repetitive procedure approvals** — end-of-day batch sign-off on injection and pellet implant procedures following standing protocols. High volume, low clinical judgment, consumes physician time daily.
2. **Visit documentation** — hour-long sessions (including therapy-adjacent hormone consultations) require detailed clinical notes. Notes pile up and get done after hours ("pajama time charting"), causing burnout.
3. **Incoming fax/document processing** — faxes from other providers arrive on a physical fax machine and must be manually read, categorized, matched to patients, and filed. Consumes entire staff's time.
4. **Paper document backlog** — 15,000 historical paper documents need scanning and entry into the EMR. Disaster recovery risk but not an active time cost.

## System Architecture

```
+---------------------------------------------------+
|                  emrai Web App                     |
|           (Next.js — any browser/Chromebook)       |
+----------+-----------------+----------------------+
| Module 1 |    Module 2     |      Module 3        |
| Batch    |    Scribe       |   Fax/Doc Processor  |
| Approvals|                 |                      |
| (Phase 1)|    (Phase 2)    |      (Phase 3)       |
+----+-----+-------+---------+-----------+----------+
     |             |                     |
     v             v                     v
+---------------------------------------------------+
|              Backend API (Go)                      |
|       Auth - Jobs - Audit Log - Multi-tenant       |
+--------------+---------------+--------------------+
| AWS Transcr  |  Claude API   | athenahealth API   |
| Medical      |  (via Bedrock)|                    |
+--------------+-----+---------+--------------------+
                     |
              +------+------+
              | AWS Textract |
              +-------------+
```

### Tech Stack

- **Frontend:** Next.js (React) — browser-based, works on Chromebooks, desktop, telehealth
- **Backend:** Go — single binary deployment, excellent concurrency for audio streaming
- **Database:** PostgreSQL — encrypted at rest, stores transcripts, notes, audit logs
- **Auth:** Role-based access control (physician vs. staff views)

### AWS Services

- **Transcribe Medical** — real-time streaming speech-to-text, medical terminology trained
- **Bedrock (Claude)** — summarization, data extraction, document classification
- **Textract** — OCR for faxed/scanned documents
- **S3** — encrypted document/artifact storage
- **RDS** — managed PostgreSQL

### External Integrations

- **athenahealth API** — read/write patient data, documents, orders (800+ REST endpoints, FHIR + proprietary)
- **eFax service (TBD)** — replace physical fax machine, provide API-accessible ingest (prerequisite for Module 3)

### EMR Abstraction

Athena integration sits behind an abstraction layer so other EMRs can be supported later (monetization path).

### Authentication & Authorization

- **User authentication:** OAuth 2.0 / OIDC — initially simple email/password with MFA, with option to add athenahealth SSO later
- **athenahealth API auth:** OAuth 2.0 authorization code flow per athenahealth's requirements. The physician authorizes the application to act on their behalf. Tokens stored encrypted in the database, refreshed automatically.
- **API write-backs use the physician's OAuth credentials** — approvals and notes are written under the physician's identity, not a service account. This preserves audit trail integrity and legal standing.
- **Session management:** JWT with short-lived access tokens, refresh tokens, automatic idle timeout (configurable, default 15 minutes per HIPAA best practice)
- **RBAC roles:** physician (full access, approval authority), staff (view dashboards, confirm document routing, no approval authority)

### Error Handling & Failure Modes

- **Athena API unavailable:** Write operations (approvals, notes) are queued locally with retry logic. Physician is notified of pending items. No silent failures.
- **Claude returns malformed output:** Validation layer checks structure before displaying in review UI. Falls back to raw transcript/data with a warning.
- **Transcription connection drop (Module 2):** Audio is buffered locally in the browser during streaming. If the WebSocket drops, buffered audio is replayed on reconnect. If the session cannot be recovered, the local buffer is uploaded as a batch job.
- **OCR failure (Module 3):** Document goes to manual review queue with the original image attached.
- **Athena API rate limits:** Request queue with backoff. Batch operations are throttled to stay within limits.

## Critical Pre-Implementation Risk: athenahealth API Capabilities

Before writing any code, we must verify through the Athena developer sandbox:

1. **Can procedure orders be approved/signed programmatically via API?** Many EMR APIs restrict physician signature to in-app actions for liability reasons. If this is not possible, Module 1 pivots to a "preparation" tool that stages orders for rapid one-click approval within athenaOne itself (still saves time, just less than full automation).
2. **Which Clinical Document endpoint accepts free-text notes linked to an encounter?** Module 2 depends on this.
3. **What scopes/permissions are required for each module's API calls?**
4. **Does the practice need Platform Services or can we use Certified API access?**

This API audit is the first task in the implementation plan — it determines whether Module 1 is "approve from emrai" or "prepare in emrai, approve in Athena."

## Module 1: Batch Approvals (Phase 1)

### Purpose

Replace the manual end-of-day process of individually clicking through and approving routine injection and pellet implant procedure orders in athenaOne.

### Workflow

1. Physician opens Approvals dashboard at end of day
2. Backend pulls pending orders from Athena API, filtered to injection & pellet implant procedures
3. Dashboard displays batch list with patient context
4. Claude reviews each pending order against patient's recent chart data (pulled from Athena) and flags non-routine items:
   - Dose changes
   - New patients
   - Missing recent labs
   - Anything outside configured standard protocols
5. Routine (unflagged) cases can be batch-approved with one click
6. Flagged cases require individual physician review
7. Approvals written back to Athena via API
8. Audit log records: who, what, when, batch vs. individual review

### Protocol Templates

Configurable standard protocols drive the flagging logic. Example:
- "Testosterone pellet 200mg for established patient with labs within 90 days = standard"
- Thresholds adjustable over time based on physician feedback

### Guard Rails

- Physician sees every item — this is not auto-approving
- Flags ensure clinical judgment is applied where needed
- Full audit trail for HIPAA and malpractice hygiene

## Module 2: Scribe (Phase 2)

### Purpose

Automate clinical documentation for patient visits, especially hour-long therapy-adjacent hormone consultations that currently result in after-hours note writing.

### Workflow

1. Physician clicks "Record" in browser (or auto-starts for telehealth)
2. Audio streams to backend via WebSocket
3. Backend streams to AWS Transcribe Medical (real-time streaming API)
4. Raw transcript accumulates with speaker diarization (Provider vs. Patient)
5. Visit ends, physician clicks "Stop"
6. Full transcript sent to Claude API with specialty-tuned prompt
7. Structured clinical note generated (SOAP or physician's preferred format)
8. Two-pane review UI: transcript on left, generated note on right
   - Click note section to highlight corresponding transcript
   - Edit inline
9. One click to push approved note to Athena via Clinical Document API

### Audio Capture Scenarios

- **Telehealth (desk/home):** Browser captures system audio + mic via MediaRecorder API
- **In-person (office):** Chromebook in room runs web-based recorder, single mic captures both speakers
- **No app install required** — pure browser-based

### Summarization

- Template system for customizable note formats
- Specialty-specific context: hormone treatment protocols, common medications, dosage patterns
- Prompt tuned over time based on physician feedback
- Handles long sessions: ~8-10k words per hour of conversation, well within Claude context limits

### Audio Resilience

- Audio is buffered locally in the browser during streaming as a safety net
- If WebSocket connection drops, buffered audio replays on reconnect
- If session is unrecoverable, local buffer can be uploaded for batch transcription
- After successful transcription and physician approval of the note, the local buffer is cleared
- Audio is never persisted server-side — the buffer exists only in the browser during the active session
- Accepted tradeoff: if the browser crashes AND the WebSocket was down, that segment is lost. Physician can re-dictate or type that portion manually.

### Speaker Diarization Considerations

- Single-mic diarization accuracy is imperfect — the summarization prompt must function gracefully with noisy or missing speaker labels
- For in-person visits, we recommend a simple two-position setup (e.g., a USB conference mic on the desk) but do not require it
- The review UI allows manual speaker label correction before summarization if needed
- For telehealth, channels are already separated — diarization is reliable

### Data Handling

- Audio is ephemeral — buffered in browser during session, never stored server-side
- Transcript and final note stored encrypted, linked to Athena patient/encounter

## Module 3: Fax/Document Processor (Phase 3)

### Prerequisites

- Migration from physical fax machine to HIPAA-compliant eFax service with API access (e.g., SRFax, Updox, RingCentral for Healthcare)
- eFax service selection TBD — owner has VOIP industry contact for recommendations

### Ingest Layer

```
Fax machine / eFax API / physical mail scanner
        |
        v
Ingest layer (normalize to digital documents)
        |
        v
OCR via AWS Textract (for image-only documents)
        |
        v
Classification + extraction + routing pipeline
        |
        v
Push to Athena patient chart via API
```

### Workflow

1. Backend polls eFax API (or receives webhook) for new documents
2. OCR via Textract if document is image-only (Athena may provide text for some)
3. Claude analyzes each document:
   - **Classification:** lab result, referral, records request, prior auth, insurance, etc.
   - **Patient matching:** cross-reference extracted patient info (name, DOB, MRN) against practice roster in Athena
   - **Data extraction:** discrete values from labs (hormone levels, CBC, metabolic panel), referral details (referring provider, reason, urgency)
4. Staff dashboard shows processed inbox:
   - Auto-routed items (high-confidence patient match + classification): staff confirms or corrects
   - Unmatched/uncertain items: staff manually assigns
   - Extracted discrete data: review before committing to chart
   - **Nothing is committed to a patient chart without staff confirmation** — auto-routing pre-fills the destination, it does not auto-commit
5. Confirmed items pushed to Athena patient chart via API

### Patient Matching

- Matching inputs: patient name, DOB, MRN (if present), phone number
- High confidence: exact MRN match, or (exact name + exact DOB) match against practice roster
- Medium confidence: fuzzy name match + DOB, or exact name without DOB — flagged for staff review
- Low confidence / no match: goes to unmatched queue
- Multiple matches at same confidence: flagged for staff disambiguation
- All matches are suggestions — staff confirms before any chart action

### Design Philosophy

Staff reviews pre-processed results instead of doing the processing. Like an email spam filter — most things are auto-sorted, staff handles exceptions.

## Module 4: Paper Backlog Scanner (Future)

Same pipeline as Module 3 (scan -> OCR -> classify -> extract -> file), pointed at the 15,000 historical paper documents instead of incoming faxes. Would use the ingest layer built for Module 3 with a bulk scanning workflow.

## HIPAA Compliance

### Business Associate Agreements

- AWS BAA covers: Transcribe Medical, Bedrock, Textract, S3, RDS
- Anthropic BAA available for Claude API (also covered under AWS Bedrock BAA)
- eFax service BAA (required, most HIPAA-compliant services offer this)
- athenahealth BAA (already in place as EMR provider)

### Technical Controls

- All data encrypted in transit (TLS 1.2+) and at rest (AES-256)
- Audio is ephemeral — streamed and discarded after transcription (never stored)
- Audit logging on every PHI access, modification, and approval action
- Role-based access controls (physician vs. staff)
- No PHI in application logs
- Automatic session timeout (15 minutes idle, configurable)
- MFA required for physician accounts
- Minimum necessary principle: API calls pull only the specific patient data fields needed for each operation, not full records
- Organizational HIPAA requirements (risk assessment, breach notification procedures, workforce training) are out of scope for this technical spec but must be addressed before production deployment

### Access

- athenahealth API access requires either Platform Services contract or Marketplace Partner Program entry
- Developer sandbox available for initial development and testing
- Production OAuth credentials required for go-live

## Build Phases

| Phase | Module | Priority | Complexity |
|-------|--------|----------|------------|
| 1 | Batch Approvals | Quick win — daily physician time | Low-Medium |
| 2 | Scribe | Biggest time savings — after-hours charting | Medium-High |
| 3 | Fax/Doc Processor | Staff time multiplier | High |
| 4 | Paper Backlog | Disaster recovery | Medium (reuses Phase 3) |

## Development Environment

- **Local dev:** Mac Mini running Docker Compose (Go backend + PostgreSQL)
- **AWS dev account:** Direct access to Transcribe Medical, Bedrock, Textract for development
- **Athena sandbox:** Preview environment with test data for API development
- **Production:** AWS (specific deployment architecture TBD in implementation plan)

## Monetization Considerations

- EMR abstraction layer enables support for other EMRs beyond athenahealth
- **Multi-tenancy approach:** Build single-tenant first with tenant ID on all database tables and API routes from day one. This is a low-cost structural decision that avoids a painful refactor later, without adding architectural complexity now. No schema-per-tenant or database-per-tenant until proven necessary.
- Protocol templates are practice-configurable (not hardcoded to one specialty)
- Per-visit and per-document cost modeling needed before scaling (Transcribe Medical ~$3-4/hour session, Claude API calls add to that — manageable for one practice, material at scale)
