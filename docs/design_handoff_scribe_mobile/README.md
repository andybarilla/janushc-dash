# Handoff: Janus Scribe — Mobile

## Overview

A phone-sized companion to the existing **Scribe** desktop screen (already implemented). Lets clinicians **record encounters on their phone**, review AI-extracted notes, approve each section, post LLM-feedback notes for model improvement, and send the approved chart to the EHR.

Same data model, same pipeline states, same approval rules as desktop. Just laid out for a 375–430px viewport with a Quickstart home screen, touch-friendly hit targets, and stack navigation instead of a two-pane layout.

## About the Design Files

The files in this bundle are **design references created in HTML** — interactive prototypes showing intended look and behavior, not production code to copy directly. The HTML uses inline-Babel JSX and CSS custom properties; treat it as the design source-of-truth, **not** as something to ship.

Your task is to **recreate these designs in the existing Janus Dashboard codebase** using the patterns and libraries already established there (presumably React + the same token system you used for the desktop Scribe screen). If a mobile-app shell already exists, follow its conventions for navigation, sheets, and headers.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, hit targets, animations, and copy. Recreate pixel-accurately using the existing design tokens (`colors_and_type.css`) and component conventions. The only thing that should change in production is the framework idiom (React Native vs. responsive web vs. native iOS, depending on how the team is shipping mobile).

## Target Form Factor

- **Width:** 375–430px (designed at 402px / iPhone 15 Pro)
- **Height:** 800+ (designed at 874px)
- **Safe areas:** Top bar pads 50px for the dynamic island region; bottom bar pads 28px for the home indicator. If using `env(safe-area-inset-top/bottom)`, that's preferable.
- **Touch targets:** All actionable elements ≥ 38px on a side; primary CTAs are 44px+.
- **Scroll regions:** The main body scrolls; the top header and bottom Send bar are sticky outside the scroll container.

## Screens / Views

There are **four top-level views** in a stack, plus a **bottom sheet** that overlays Detail.

Navigation model:
```
Home ─┬─► Record  ─► (idle → recording → review → uploading) ─► Home
      ├─► Inbox   ─► Detail ─► (Feedback sheet)
      └─► Detail (direct, from Recent list)
```

Home is the launch screen. From Home the user can: start a recording, jump to the Inbox filtered to any status, or open a specific encounter from the Recent list. Every non-Home screen has a back chevron to return.

### 1. Home (Quickstart)

**Purpose:** Be the launch screen. Surface the two most-common actions (record a new session, approve ready ones) above the fold and give one-tap access to every status bucket.

**Layout (top to bottom):**
1. **Top bar** (sticky, white, 50px top padding)
   - Brand lockup on the left (28px "J" disc + JANUS / Scribe stack — same as Inbox)
   - Right cluster: bell icon (with amber dot if any attention-needing items) + profile icon button
2. **Greeting** (14×20 padding)
   - "Good morning," / "Good afternoon," / "Good evening," based on local hour (12/18 cutoffs)
   - Provider name, 22px / 700 / `--primary-color`
   - Long-form date (e.g. "Tuesday, May 19"), 12px / `--text-light`
3. **Primary CTA card** (16px margin, full-width minus 32px, 18px radius, `--primary-color` background)
   - Left: 52px round mic icon with 1.5px white-35% outline + radial accent glow + outward pulsing ring (2.2s loop)
   - Center: "Record a session" (17px / 700) + "Saved on device, uploaded when synced" (12px / 78% white)
   - Right: chevron-right
   - Shadow: `0 8px 22px rgba(44, 95, 125, 0.30)`
4. **Review shortcut** (12px gap below CTA, `--warning-bg` / `--warning-border` / `--warning-text`)
   - Big tabular count (26px / 700) on the left
   - Two-line title + subtitle ("Sessions ready for your review" / "Approve sections and send to EHR")
   - Chevron right
   - **Empty state** (when ready === 0): swap to `--bg-light` background, `--border-color` border, `--text-light` text, title "You're all caught up", subtitle "No sessions awaiting review", no chevron (it's not actionable)
5. **Attention shortcut** (only when failed + ehr_failed count > 0, same shape but `--error-bg` / `--error-border` / `--error-text`)
   - "N sessions need attention" / "Failed transcription or EHR sync"
6. **"Today" section label** (11px uppercase, `--text-light`, 22px top / 8px bottom padding)
7. **Tiles grid** (2 columns, 10px gap, 16px horizontal margin)
   - **In pipeline tile** (`progress` variant): blue-tinted icon disc + 24px count + label
   - **Sent to EHR tile** (default): bg-light icon disc + 24px count + label
   - Both tiles are tappable and open the Inbox filtered to that bucket
8. **"Recent" section label**
9. **Recent list** (white card with `--radius-card`, 1px border, internal border-bottoms between rows)
   - 4 rows max, sorted by `receivedAt` desc
   - Each row: 30px round status-colored icon (success for sent, attention for ready, error for failed, progress for in-flight) + patient name (13px / 600 / tabular) + status sub-line ("Sent to EHR · 18m ago" / "Ready for review · 12m ago" / etc.) + right chevron
   - Tap any row → open that encounter's Detail directly (skip the Inbox)
10. **"View full inbox (N) →"** text button at the bottom, centered

**Behavior:**
- Greeting line is computed client-side from `new Date()`; no setting.
- All counts react live to changes in the encounter list (e.g. when a session moves Ready → Sent, the Review shortcut's count drops by 1 and the Sent tile increments).
- Recent-row tap opens Detail directly without setting any filter.
- Inbox shortcuts pre-set the status filter, so the Inbox lands already filtered.

### 2. Record (4-phase flow)

**Purpose:** Capture audio on-device. Audio is stored locally first, then uploaded to S3 in the background, where the existing pipeline (AWS HealthScribe → LLM extractor → EHR sync) takes over.

Four phases, all on one screen (just sub-views — no nav between them):

#### Phase A — Idle (pre-record)
- Top bar: "← Home" chevron, title "New session", no right action
- Form (24×20 top, on `--bg-light`):
  - "PATIENT" label + text input (auto-fills with next sequential ID like `demo-patient-011`; user can edit)
  - "DEPARTMENT" label + native select ("Department 1" / "Department 2")
- Center stage (flex 1, vertically centered):
  - 120px round red record button (`#DC2626` bg, white mic icon, `0 10px 30px rgba(220,38,38,0.35)` shadow, 8px outline ring at 20% alpha)
  - "Tap to start recording" (14px / 600)
  - 280px-max paragraph explaining the local-record-then-upload model
- Pressing the red button → transitions to Phase B, zeroes the timer

#### Phase B — Recording
- Top bar title becomes "Recording…"
- Center stage:
  - 48px / 300-weight timer in `mm:ss` (tabular), font-sans (no special display face)
  - Meta line: red blinking dot (`#DC2626`, 1.2s opacity loop) + "Recording · {patientId}"
  - Live animated waveform — 36 bars, 320px max width, 60px tall, every 3rd bar `#DC2626`, the rest at 55% alpha; bar heights animate at ~9fps via JS-driven sine
  - 120px round white **stop** button — `#DC2626` 2px border, white bg, with a 36px red square inside (square = standard "stop" affordance, contrasts with the round record button)
  - Outward pulsing ring around the stop button at 35% red, 1.6s loop
- Pressing the stop button → Phase C

#### Phase C — Review
- Top bar title "Review recording"
- Center stage:
  - 96px round success-tinted check disc (pop-in animation: scale 0.6 → 1, 0 → 1 alpha, 0.4s)
  - "Recorded {mm:ss}" (20px / 700 / `--primary-color`)
  - 2-line subtitle: "{patientId} · {department}" + "Saved on device. Ready to queue for transcription."
  - Audio playback strip (90% width, same chrome as the detail-view audio strip — round play button + waveform + time)
- Bottom actions tray (white bg, 1px top border, 16×20 + 28px home-indicator padding):
  - Primary: "📤 Save & queue for processing" (full-width pill)
  - Secondary row (2 buttons, 50/50): "Re-record" (resets to Phase B) and "Discard" (red ghost — returns to Home, drops the recording)
- Pressing the primary → Phase D

#### Phase D — Uploading
- Top bar title "Saving"
- Center stage:
  - 96px round teal-tinted upload-cloud disc (pop-in)
  - "Uploading…" title
  - 6px tall × 280px max progress bar with infinite indeterminate fill (2.2s ease-out loop: 0% → 85% → 100%)
  - 2-line subtitle: "{patientId} · {mm:ss}" + "Once uploaded, transcription will start automatically."
- After ~2.2s the screen pops back to Home and the new encounter shows up in the Recent list as `queued` (in production: when the upload actually completes, your backend should write the encounter and the home polling should pick it up).

**Behavior notes:**
- Timer is a real `setInterval` that ticks every 1s. Stop button captures the elapsed time and carries it through.
- Discard from any phase returns to Home without persisting anything.
- In production: write audio chunks to the device filesystem during Phase B so a crash doesn't lose the recording. Upload starts only on Phase D ("Save & queue"), not during recording.

### 3. Inbox (list view)

**Purpose:** Triage today's encounters. See what's ready for review at a glance, filter by status, jump into a record.

**Layout (top to bottom):**
1. **Top bar** (sticky, white, `border-bottom: 1px solid --border-color`)
   - 50px top padding (dynamic island clearance)
   - **"← Home" back chevron** on the left (when reached from Home)
   - Compact brand lockup: 24px round "J" disc + two-line "JANUS / Inbox"
   - Right cluster: Search icon button + Bell icon button (amber dot if unread)
2. **Stats row** (horizontal scroll, gap 8px, padding 12px 16px)
   - 5 stat chips: Today / Ready / Pipeline / Sent / Attn
   - Each chip 110px min-width, 10px×14px padding, `--white` bg with `--shadow-card`, `--radius-card` corners
   - Ready chip uses `--warning-bg` background; Attn chip uses `--error-bg`
   - Two-line content: uppercase 10px label + tabular 22px value
3. **Filter row** (sticky to body scroll, padding 10px 16px 12px, `--bg-light` bg, `border-bottom`)
   - Horizontal scroll, chips inline
   - 5 filter chips: All / Ready / In pipeline / Sent / Attn
   - Each chip 1.5px outline, `--radius-pill`, 6×12px padding, 12px font-weight 600
   - Active state: `--primary-color` background, white text, white-25% count badge
   - Inactive: white bg, `--text-light` text, `--bg-light` count badge
4. **List meta** (12px 16px 6px, 11px uppercase tabular)
   - "N encounters" on the left, "Newest first" on the right
5. **Session list** (white, no horizontal padding)
   - Each row: 14×16 padding, `border-bottom: 1px solid --border-color`, 3px transparent left border (selected = teal)
   - Row content:
     - Top line: patient name (14.5px / 600 / tabular) left, status pill right
     - Encounter ID (12px / `--text-light`, single line ellipsis)
     - Meta row (11px / `--text-light` / tabular): clock + duration · file + word count · relative time right-aligned
   - Active highlight: `rgba(44, 95, 125, 0.08)` on tap, `-webkit-tap-highlight-color` matches

**Tap behavior:** Tap any row → push the Detail view onto the stack. The selected row's ID is remembered when popping back.

**Empty state:** When no rows match the filter, show centered inbox icon + "No encounters match that filter."

### 4. Detail view

**Purpose:** Review one encounter. Approve each structured section individually, post feedback if the model got something wrong, then send the whole chart to the EHR.

**Layout (top to bottom):**
1. **Top bar** (sticky, white)
   - Left: "← Inbox" back chevron (22px chevron + 15px label, `--primary-color`)
   - Center: patient name (truncated, 15px / 700, max 200px)
   - Right: 38px round more-horizontal icon button
2. **Encounter header card** (white, 16×16 padding, border-bottom)
   - Title row: patient name (18px / 700 / `--primary-color`) and `--patient-sub` (encounter ID, 12px / `--text-light`) on the left, large status pill on the right
   - Meta row: wraps with 8/14px gaps; provider · department · audio duration · word count, each prefixed by its Lucide icon (12px, `--text-light`)
3. **Audio strip** (only when sections exist; 12×16 margin, `--bg-light` bg, `--radius-card`)
   - 34px circular teal play button + stylized waveform SVG + tabular time "0:48 / 24:12"
   - Waveform: 60 vertical bars, first 7 in solid `--primary-color` (played), rest in 25% alpha (unplayed)
4. **Pipeline tracker** (only when status is queued/transcribing/extracting; `--bg-light` bg, `--radius-card`)
   - "PIPELINE" 10px label, then 4-step tracker: Queued → Transcribing → Extracting → Ready
   - Each step: 18px circle (border-color default, success green for done, primary teal with pulse for active) + 10px caption
   - Horizontal connector behind dots fills in success green as steps complete
5. **Failure banner** (only when status is `failed`; `--error-bg`, `--error-border`, `--error-text`)
   - Alert triangle icon + bold one-liner + body + inline "Retry pipeline" pill button
6. **EHR-sync-failed banner** (only when status is `ehr_failed`; same shape but `--warning-bg/border/text`)
   - Cloud-alert icon + "EHR sync failed — content approved" + Retry sync button
7. **Approval mini-bar** (sticky to body scroll; white bg, top 0 of scroll container)
   - "N of 4 approved" (bold count is `--primary-color`, tabular) + 4 pip squares (success green when done, border-color otherwise) + right-aligned Feedback button (shows count dot if notes exist)
8. **Sections** (12×16 padding, gap 12px, four cards in order: HPI → Plan → Exam → Labs)
   - Each section card: 1.5px border (default border-color; success-border if approved; warning-border if has notes; success wins when both)
   - Head: 10×14 padding, `--bg-light` bg (success-bg if approved), 26px section icon + uppercase 11.5px title + right-aligned 28px feedback action button with pip badge if notes
   - Body: 12×14 padding, 14px/1.55 line-height
   - Approve bar at bottom: white bg (success-bg if approved), full-width `--radius-pill` button — "Approve section" (outline grey when off) → "Approved" (success-tinted with checkmark when on)
9. **Transcript card** (white, 1.5px border, `--radius-card`)
   - Collapsed toggle (default): `--bg-light` bg, chevron caret + "TRANSCRIPT" + right-aligned word count
   - Expanded: 320px max-height scroll region with timestamped turns
   - Each turn: 3-column grid [38px timestamp · 60px speaker label · text]
   - Provider rows show "Provider" in `--primary-color`; Patient rows show "Patient" in `--secondary-color`
10. **Bottom send bar** (sticky outside scroll, white bg, top border, 12×16 + 28px bottom for home indicator)
    - Left: "Approve all" outline button (hidden once all four sections are approved)
    - Right: "Send to EHR" primary pill — full width when alone, flex-grows when paired
    - Send is `disabled` (border-color bg, text-light label) until all four `approvals` are true
    - When status is `sent`, label becomes "Sent to EHR" with check icon and remains disabled

#### Section content details

- **HPI:** single `<p>` of free text from `encounter.sections.hpi.body`
- **Assessment & Plan:** ordered list with circular grey number badges (20px, primary teal text)
- **Physical Exam:** preformatted (`white-space: pre-wrap`) so the line breaks in the source render
- **Diagnoses & Labs:** 2-column table — diagnosis name + small grey ICD-10 code chip in column 1, related labs/details in column 2

### 5. Feedback sheet (bottom sheet)

**Purpose:** Capture structured notes that improve the LLM extraction model. **This is NOT clinical documentation** — the sheet header explicitly says "Notes train the model · not part of the chart."

**Trigger:** Either the Feedback button in the approval mini-bar (targets "Whole encounter") or the message-icon in a section head (targets that section).

**Layout (presented over the Detail view):**
- Scrim: 32% black, fades in over 250ms `cubic-bezier(.4, 0, .2, 1)`
- Sheet: slides up from bottom, transform translateY(100% → 0) over 300ms same ease
- Max height 78% of frame
- Corner radius: 24px top corners, square bottom
- Shadow: `0 -8px 24px rgba(0,0,0,0.12)`
- Internal layout:
  1. **Grab handle** (36×5px, `--border-color`, centered, 8px top margin)
  2. **Head** (6×16 padding, border-bottom): message icon + two-line title ("LLM Feedback" / "Notes train the model · not part of the chart") + 30px round close button
  3. **Notes list** (flex 1, scrollable, 14×16 padding, gap 10px)
     - Each note: `--bg-light` bg, 3px left border colored by category (warning for missed/formatting, error for incorrect/hallucination, success for good, default for comment), 10×12 padding, 8px corners
     - Note head: 20px round author monogram + author name + time-ago + category tag pill (right)
     - Optional "In HPI" / "In Assessment & Plan" target line (10px uppercase) when scoped to a section
     - Body: 12.5px / 1.45 line-height
  4. **Composer** (top border, `--bg-light` bg, 12×16 padding, 18px bottom)
     - Horizontal scroll of 6 category chips: Missed info / Incorrect extraction / Hallucination / Formatting / Good output / General comment (Lucide icon + label, active = primary teal fill)
     - Target select: "Target:" label + native `<select>` with Whole encounter / HPI / Plan / Exam / Labs
     - Textarea: 1.5px border, `--radius-input`, 70px min-height, placeholder "Describe what to fix or improve. Specific examples help most."
     - Right-aligned actions: Cancel ghost + "Post" primary pill (disabled until textarea is non-empty)

**Dismiss:** Tap the scrim, tap the close button, or swipe down on the handle (if your sheet primitive supports it).

## Interactions & Behavior

### Navigation
- App launches at **Home**
- Home → tap primary CTA → push **Record**
- Home → tap review/attention shortcut, or tile → push **Inbox** with that filter applied
- Home → tap a Recent row → push **Detail** for that encounter (skips Inbox)
- Inbox → tap row → push **Detail**
- Detail → tap "← Inbox" → pop to Inbox
- Inbox → tap "← Home" → pop to Home
- Record (any phase except Uploading) → tap "← Home" → discard and return to Home
- Record → Phase D completes → auto-pop to Home (the new session should appear in Recent)
- Detail → tap feedback button → present sheet over current view
- Sheet open → tap scrim/close/swipe down → dismiss sheet (Detail view stays)

### Section approval (per-section)
- Tap "Approve section" → toggles `approvals[sectionKey]` boolean
- Toggling on: section card border + head bg switch to success tones (250ms transition), approve button label changes to "Approved", approval mini-bar pip fills green, count increments
- Tapping again toggles off
- Approving the 4th section enables the "Send to EHR" primary button
- "Approve all" in the bottom bar sets all four to true at once (and hides itself when all are already true)

### Sending to EHR
- Disabled state: button is `--border-color` bg, `--text-light` label, `cursor: not-allowed`
- Enabled state: full `--primary-color` bg, white label, send icon
- On tap (when enabled): set the encounter status to `STATUS.SENT`, record `sentAt`, label switches to "Sent to EHR" with check icon, button remains disabled to prevent double-send
- In production this should fire the EHR sync API call; the prototype just flips state

### Feedback note submission
- Submitting appends a new note with: `author`, `authorInitials`, `at: new Date().toISOString()`, `category`, `section`, `body`
- Notes list scrolls/animates to show the new note (prototype just re-renders)
- The encounter's notes count updates everywhere it appears: section head pip, approval-bar Feedback count dot, sheet list

### Recording flow
- **Local-first.** Audio is captured into the device filesystem during Phase B. The upload to S3 only starts when the user taps "Save & queue for processing" in Phase C.
- **Crash safety.** If the app crashes mid-recording, the partial file should be recoverable on next launch and either offered as a draft ("Resume {patientId} (1:23 recorded)") or auto-discarded with a toast.
- **Background upload.** Once Phase D starts, the upload should continue in the background even if the user navigates away. Surface its progress in a small banner on Home ("Uploading {patientId}…") if you have a notifications/banners system.
- **Permissions.** Microphone permission must be requested before Phase B starts. If denied, show a permission-needed state in place of the red button with a link to system settings.
- **No editing.** The user cannot trim/edit audio — only re-record or discard. (We can add trim in a future iteration if reviewers ask for it.)

### Status states & what they unlock
| Status | Audio strip | Pipeline tracker | Sections shown | Approval bar | Send button |
|---|---|---|---|---|---|
| Queued | ❌ | ✅ | ❌ (empty state) | ❌ | ❌ |
| Transcribing | ❌ | ✅ | ❌ | ❌ | ❌ |
| Extracting | ❌ | ✅ | ❌ | ❌ | ❌ |
| Ready | ✅ | ❌ | ✅ | ✅ | ✅ (gated on all approved) |
| Sent | ✅ | ❌ | ✅ | ✅ | "Sent to EHR" (disabled) |
| Failed | ❌ | ❌ | Failure banner only | ❌ | ❌ |
| EHR sync failed | ✅ | ❌ | ✅ + amber banner | ✅ | ✅ (already approved, retry available) |

### Filters (Inbox)
- **All** — every encounter
- **Ready** — status === 'ready'
- **In pipeline** — status ∈ {'queued', 'transcribing', 'extracting'}
- **Sent** — status === 'sent'
- **Attn** — status ∈ {'failed', 'ehr_failed'}

### Animations
- Sheet enter/exit: 300ms `cubic-bezier(.4, 0, .2, 1)` (var: `--motion-ease`)
- Scrim fade: 250ms same ease
- All hover/active color transitions: 300ms ease (var: `--motion-fast`)
- Pipeline active step pulse: 1.6s ease-in-out infinite, ring expands from 4px → 8px
- Approve button tap: `transform: scale(0.98)`
- Status pill in-pipeline icon: 2.4s linear infinite spin

## State Management

Encounter object is the source of truth. The prototype keeps the whole list in component state; in production this should hydrate from your backend and the mutations below should fire API calls.

The Home screen reads the live encounter list to compute its counts and recent activity — no separate "dashboard" model needed.

```ts
type Encounter = {
  id: string;
  patient: { id: string; name: string };
  encounterId: string;            // human-readable, e.g. "demo-encounter-apr-14-at-1-26-pm"
  department: string;
  provider: string;
  receivedAt: string;             // ISO 8601
  audioDurationSec: number;
  transcriptWordCount: number;
  status: StatusDescriptor;       // { id, label, color, icon }
  sections?: {                    // only present once Extracting completes
    hpi:  { title: string; icon: string; body: string };
    plan: { title: string; icon: string; body: string[] };   // ordered list
    exam: { title: string; icon: string; body: string };     // preformatted
    labs: { title: string; icon: string; body: Array<{ dx: string; detail: string }> };
  };
  approvals: { hpi: boolean; plan: boolean; exam: boolean; labs: boolean };
  notes?: Note[];
  transcript?: TranscriptTurn[];
  error?: string;
  ehrError?: string;
  sentAt?: string;
  pipelineProgress?: number;      // 0..1, for in-pipeline records
};

type StatusDescriptor = {
  id: 'queued' | 'transcribing' | 'extracting' | 'ready' | 'sent' | 'failed' | 'ehr_failed';
  label: string;
  color: 'neutral' | 'progress' | 'attention' | 'success' | 'error' | 'warning';
  icon: string;                   // Lucide icon name
};

type Note = {
  id: string;
  author: string;
  authorInitials: string;
  at: string;
  section: 'overall' | 'hpi' | 'plan' | 'exam' | 'labs';
  category: 'missed_info' | 'incorrect' | 'hallucination' | 'formatting' | 'good' | 'comment';
  body: string;
};

type TranscriptTurn = { t: string; who: 'Provider' | 'Patient'; text: string };
```

### Mutations
- `createEncounter({ patientId, department, audioBlob })` — called when the user finishes recording. Server should assign the canonical ID, store the audio, return the new encounter in `queued` state. Add to the local cache immediately so it appears in Home/Recent.
- `approveSection(encounterId, sectionKey)` — toggle the boolean
- `approveAll(encounterId)` — set all four to true
- `sendToEHR(encounterId)` — set status to 'sent', record sentAt; only call when all four approvals are true
- `retryPipeline(encounterId)` — re-queue (failed → queued)
- `retryEhrSync(encounterId)` — retry the EHR call for ehr_failed records
- `addNote(encounterId, { category, section, body })` — append to notes; stamp author/initials/timestamp server-side

### Data needs
- Initial fetch: list of encounters for current user's department, scoped to today by default — drives both Home and Inbox
- Polling or WebSocket subscription on pipeline state for in-progress records (to advance the tracker live and to bump the Home tiles as states transition)
- An audio-capture binding (Web `MediaRecorder`, `react-native-audio-recorder-player`, AVAudioRecorder, etc.) plus a local-file → S3 multipart-upload binding for the Record flow
- The prototype uses local mock data (`scribe-data.js`); replace with your API client

## Design Tokens

All values come from `colors_and_type.css` (already in your codebase from the desktop implementation). Do **not** invent new colors — only use these tokens or alpha tints of them.

### Colors (used in mobile)
```
--primary-color:   #2C5F7D    /* CTA, headings, active states */
--secondary-color: #4A90A4    /* secondary speaker (Patient) */
--accent-color:    #7FC8D9    /* gradient stop, accents */
--text-dark:       #333333
--text-light:      #666666
--bg-light:        #F8F9FA    /* page bg, recessed surfaces */
--white:           #FFFFFF    /* cards, top bar */
--border-color:    #E0E0E0

--success-bg:     #D4EDDA
--success-border: #C3E6CB
--success-text:   #155724
--error-bg:       #F8D7DA
--error-border:   #F5C6CB
--error-text:     #721C24
--warning-bg:     #FFF3CD
--warning-border: #FFC107
--warning-text:   #856404
```

### Typography
- `--font-sans` — system stack, body
- `--font-display` — Cinzel, used for the "Janus" wordmark in the brand lockup (NOT for module name or anywhere else in mobile)
- Type scale: 10/11/11.5/12/12.5/13/14/14.5/15/18/22 — tabular-nums on all numeric values (counts, durations, IDs, ICD-10 codes)

### Spacing
- Card radius: `--radius-card` (10px)
- Pill radius: `--radius-pill` (50px) — buttons, chips, status pills
- Input radius: `--radius-input` (5px) — text fields, native selects
- Section internal padding: 12×16
- Card internal padding: 10×14 (head), 12×14 (body)
- Top bar dynamic-island clearance: 50px top
- Bottom bar home-indicator clearance: 28px bottom

### Shadows
- `--shadow-card` — used on the floating stat chips at the top of the inbox
- Sheet shadow: `0 -8px 24px rgba(0, 0, 0, 0.12)` (custom, only used by the bottom sheet)

### Status pill color mapping
| Pipeline state | `color` token | Tint |
|---|---|---|
| Queued | `neutral` | `--bg-light` / `--text-light` |
| Transcribing | `progress` | `rgba(74, 144, 164, 0.12)` / `--primary-color` |
| Extracting | `progress` | same |
| Ready | `attention` | `--warning-bg` / `--warning-text` |
| Sent | `success` | `--success-bg` / `--success-text` |
| Failed | `error` | `--error-bg` / `--error-text` |
| EHR sync failed | `warning` | `rgba(255, 193, 7, 0.16)` / `--warning-text` |

## Assets

- **Icons:** [Lucide](https://lucide.dev) — every glyph in the design is a Lucide icon. Use whatever Lucide binding your stack prefers (`lucide-react`, `lucide-react-native`, SF Symbols equivalents for native iOS, etc.). Specific icons used: `search`, `bell`, `chevron-left`, `chevron-right`, `chevron-down`, `more-horizontal`, `x`, `check`, `check-check`, `check-circle-2`, `circle`, `circle-dot`, `circle-check`, `circle-help`, `circle-x`, `clock`, `inbox`, `mic`, `sparkles`, `play`, `download`, `send`, `refresh-ccw`, `loader`, `triangle-alert`, `cloud-alert`, `flame`, `thumbs-up`, `message-square`, `message-square-plus`, `message-square-dashed`, `align-left`, `file-text`, `clipboard-list`, `stethoscope`, `microscope`, `pill`, `user-round`, `users-round`, `building-2`, `calendar-days`, `layout-dashboard`, `chart-line`, `copy`, `upload`, `settings`.
- **Fonts:** `Cinzel-VariableFont_wght.ttf` for the "Janus" wordmark (already in your repo from the desktop work). Body uses the system font stack.
- **Audio waveform:** stylized SVG generated client-side from a deterministic sine pattern. In production, render a real waveform from the audio file (e.g. via [`wavesurfer.js`](https://wavesurfer.xyz/) on web or AVFoundation on iOS).
- **Brand mark:** the round teal "J" disc is rendered in CSS — no image asset.

## Implementation Notes for the Coder

### Recommended approach by target
- **Responsive web (same React codebase):** wrap the existing desktop Scribe at a `max-width: 640px` breakpoint and swap to these mobile components. Home, Record, Inbox, Detail, and Sheet should be different components from their desktop counterparts, not the same components restyled — the structural differences make a shared-component approach brittle.
- **React Native:** the mobile-scribe components map cleanly onto `View`/`ScrollView`/`Text` primitives. Use `react-navigation`'s stack navigator for Home→Inbox→Detail and Home→Record. `react-native-bottom-sheet` for the feedback sheet. For audio capture, `react-native-audio-recorder-player` or `expo-av` Audio.Recording.
- **Native iOS (SwiftUI):** `NavigationStack` for the stack, `.sheet(isPresented:)` with `.presentationDetents([.fraction(0.78)])` for the feedback sheet, `AVAudioRecorder` for capture. Use SF Symbols equivalents for the Lucide icons listed above.

### Gotchas the prototype handles
- Lucide icons need to be re-hydrated whenever new DOM mounts. The prototype calls `lucide.createIcons()` in a `useEffect` with no deps. Your real binding (e.g. `lucide-react`) will do this automatically.
- Horizontal-scroll regions (stats row, filter row, category chips in composer) need `scrollbar-width: none` + `-webkit-scrollbar: display: none` to hide the scrollbar but keep scroll behavior.
- The sticky approval mini-bar is sticky to the **body scroll container**, not the page — make sure your scroll setup respects that.
- The send button has three visual states: disabled-grey (not all approved), enabled-teal (ready to send), already-sent-grey (locked). Don't conflate "disabled" with "already sent" in your state machine — the UX is different even though they look similar.
- "Approve all" should NOT auto-send. Sending is always an explicit second tap on "Send to EHR." This is intentional — gives the reviewer a moment to look at the assembled chart one more time.
- The Cinzel font is the wordmark face only. Don't use it for module names ("Scribe"), titles, or anywhere else.

### Accessibility
- All buttons need accessible labels (especially icon-only ones: search, bell, more-horizontal, close, audio play).
- Approval state should be announced — `aria-pressed` on the approve toggles, `aria-disabled` on the send button.
- The sheet should trap focus and restore it on dismiss.
- Hit targets are ≥ 38px; verify with your platform's accessibility audit.

## Files in this bundle

| File | Purpose |
|---|---|
| `README.md` | This document |
| `Janus Scribe Mobile.html` | The runnable design canvas — 8 phone frames showing every state |
| `mobile-scribe.jsx` | All mobile-specific React components (list, detail, sheet, helpers). This is the **design source-of-truth** for layout, copy, and interaction behavior — reference it, don't ship it. |
| `mobile-scribe.css` | Mobile-specific styles, scoped to `.m-app` and its children. Every value is a `var(--*)` token or an alpha tint of one. |
| `scribe-data.js` | Mock data + the canonical `STATUS` map and `NOTE_CATEGORIES` list. The shape here is the contract your API should match. |
| `colors_and_type.css` | Token definitions. **Already in your codebase from the desktop work** — included here for self-containment. Don't duplicate. |

## Acceptance Checklist

- [ ] App launches on the **Home** screen, not the Inbox
- [ ] Home greeting reflects local time-of-day (morning/afternoon/evening)
- [ ] Home Review shortcut count matches the number of `ready` encounters; swaps to the empty-state when zero
- [ ] Home Attention shortcut is hidden when there are no `failed` / `ehr_failed` encounters and visible when there are
- [ ] Home tiles open the Inbox pre-filtered to the matching bucket
- [ ] Home Recent row taps open Detail directly (no Inbox in between)
- [ ] Record flow goes idle → recording → review → uploading → back to Home
- [ ] Microphone permission is requested before Phase B (in production)
- [ ] Phase B timer ticks once per second and survives backgrounding
- [ ] Phase C "Discard" returns to Home without creating an encounter
- [ ] Phase D upload happens in the background — user can navigate away during it
- [ ] All 7 pipeline states render with the correct chrome on the detail view
- [ ] Section approval state survives navigation back to the inbox and forward into the detail again
- [ ] Send to EHR is disabled until all four sections are approved
- [ ] Feedback sheet pre-targets the right section when opened from a section's message icon
- [ ] Note counts update in three places (section head pip, approval-bar count dot, sheet list)
- [ ] Failed and EHR-sync-failed banners both expose a Retry action
- [ ] Status pills match the color mapping table above
- [ ] Bottom bar respects the home-indicator inset
- [ ] Top bar respects the dynamic-island inset
- [ ] Horizontal scroll regions don't show scrollbars but do scroll
- [ ] All numeric values (counts, durations, word counts, ICD-10 codes) are tabular
