// Mock data for Janus Scribe — 7 encounters across the 7 pipeline states,
// plus a long detailed "ready_for_review" record that matches the example screenshot.

const STATUS = {
  QUEUED:        { id: 'queued',        label: 'Queued',           color: 'neutral',  icon: 'clock'         },
  TRANSCRIBING:  { id: 'transcribing',  label: 'Transcribing',     color: 'progress', icon: 'mic'           },
  EXTRACTING:    { id: 'extracting',    label: 'Extracting',       color: 'progress', icon: 'sparkles'      },
  READY:         { id: 'ready',         label: 'Ready for review', color: 'attention',icon: 'circle-dot'    },
  SENT:          { id: 'sent',          label: 'Sent to EHR',      color: 'success',  icon: 'check'         },
  FAILED:        { id: 'failed',        label: 'Failed',           color: 'error',    icon: 'triangle-alert'},
  EHR_FAILED:    { id: 'ehr_failed',    label: 'EHR sync failed',  color: 'warning',  icon: 'cloud-alert'   },
};

const PROVIDERS = ['Dr. Knutsen', 'Dr. Aldana', 'Dr. Park'];
const DEPARTMENTS = ['Department 1', 'Department 1', 'Department 2'];

// The hero record — matches the prototype screenshot the user shared.
const ENCOUNTER_001 = {
  id: 'enc_001',
  patient: { id: 'demo-patient-001', name: 'demo-patient-001' },
  encounterId: 'demo-encounter-apr-14-at-1-26-pm',
  department: 'Department 1',
  provider: 'Dr. Knutsen',
  receivedAt: '2026-05-13T09:21:29-06:00',
  audioDurationSec: 1452,      // 24:12
  transcriptWordCount: 3284,
  status: STATUS.READY,
  sections: {
    hpi: {
      title: 'HPI',
      icon: 'file-text',
      body: `Patient presents for follow-up after recent ER visits for oral thrush that was difficult to treat. Patient reports they had to advocate strongly for treatment, with providers initially suggesting antibiotics despite thrush diagnosis. Patient was initially misdiagnosed and underwent unnecessary STD panels. After persistent advocacy, patient was prescribed antifungals which completely cleared the thrush. During treatment, patient developed blisters between toes which have since resolved. Patient also reports ongoing issues with a knee scar that periodically becomes inflamed and a wrist plate that is causing discomfort. Patient requesting referral for hardware removal. Patient also discussing executive dysfunction and depression affecting ability to work, even basic gig work like Grubhub. Patient describes physical pain (stabbing pain in arms, legs, and chest) when forced to complete tasks they cannot motivate themselves to do. Reports this has worsened over the past few months. Patient is applying for disability and has started with a new therapist. Patient uses psilocybin macrodoses approximately twice yearly for symptom management. Patient expressing concerns about gender-affirming bottom surgery and need for hair removal, which is not currently covered by Medicaid in the state. Patient reports significant distress related to current political climate and safety concerns.`,
    },
    plan: {
      title: 'Assessment & Plan',
      icon: 'clipboard-list',
      body: [
        'Resolved oral thrush — Will check B12 and folate levels at next lab draw to rule out vitamin deficiency as contributing factor to recurrent mouth sores and angular cheilitis.',
        'Wrist hardware removal — Sending referral to Dr. Knutsen at UC Health (original surgeon) for plate removal due to ongoing discomfort.',
        'Knee scar with intermittent inflammation — Discussed possible keloid formation and atrophic scarring. Patient to monitor and use moisturizing lotion when inflamed. Will observe for patterns suggesting possible connective tissue disorder.',
        'Executive dysfunction and major depression — Patient to complete MDQ (Mood Disorder Questionnaire) and ADHD screening questionnaires. Starting L-methylfolate supplement to support neurotransmitter synthesis. Prescribed Viibryd (low dose) for patient to have available if decides to start antidepressant therapy after discussion with therapist. Patient to follow up with new therapist Monday and return for follow-up appointment in 1-2 weeks to discuss medication options.',
        'Sexual function concerns — Discussed topical testosterone gel for genital area to maintain function and prevent atrophy pre-bottom surgery. Patient prefers this approach over systemic bicalutamide.',
        'Gender-affirming care — Continuing current hormone therapy. Working on finding Medicaid-covered hair removal provider for pre-surgical preparation. Patient willing to be test case for Medicaid coverage.',
        'Follow-up labs — Order testosterone (free and total), estradiol, B12, and folate levels.',
        'Schedule multiple follow-up appointments for ongoing support and medication management.',
      ],
    },
    exam: {
      title: 'Physical Exam',
      icon: 'stethoscope',
      body: `Constitutional: Patient appears distressed, appropriate for age
Skin: Multiple healed scars noted including atrophic scarring on extremities with cigarette paper appearance when compressed. Knee scar with history of intermittent inflammation, currently appears slightly scaly but not acutely inflamed. Previous blister sites on feet between toes have healed well with no residual findings. Multiple small ingrown hair sites noted on thighs, not currently inflamed.
Musculoskeletal: Right wrist with palpable hardware, patient reports ongoing discomfort. Full range of motion not formally assessed.
Oropharynx: Clear, no evidence of active thrush, no angular cheilitis currently present`,
    },
    labs: {
      title: 'Diagnoses & Labs',
      icon: 'microscope',
      body: [
        { dx: 'B12 deficiency (D51.9)',           detail: 'to rule out — Vitamin B12 level' },
        { dx: 'Folate deficiency (E53.8)',         detail: 'to rule out — Folate level' },
        { dx: 'Major depressive disorder (F32.9)', detail: 'MDQ questionnaire, ADHD screening questionnaire' },
        { dx: 'Gender dysphoria (F64.0)',          detail: 'Testosterone free and total, Estradiol' },
        { dx: 'History of oral candidiasis (B37.0)', detail: 'B12 and folate (to assess for recurrence risk)' },
      ],
    },
  },
  approvals: { hpi: false, plan: false, exam: false, labs: false },
  notes: [
    {
      id: 'n_1',
      author: 'Dr. Aldana',
      authorInitials: 'AA',
      at: '2026-05-13T09:24:00-06:00',
      section: 'plan',
      category: 'missed_info',
      body: 'Model missed that patient explicitly declined SSRIs in the past — should have flagged this when proposing Viibryd.',
    },
    {
      id: 'n_2',
      author: 'Dr. Aldana',
      authorInitials: 'AA',
      at: '2026-05-13T09:25:30-06:00',
      section: 'labs',
      category: 'good',
      body: 'Nice — ICD-10 codes are correct and the rule-out framing matches what I dictated.',
    },
  ],
  transcript: [
    { t: '00:00', who: 'Provider', text: 'Hi, thanks for coming in today. How are things going since the ER visit?' },
    { t: '00:08', who: 'Patient',  text: "Better. The antifungals finally cleared it up but I really had to push to get them. They kept wanting to do STD panels." },
    { t: '00:24', who: 'Provider', text: 'Tell me about the timeline there. When did the blisters between your toes start?' },
    { t: '00:31', who: 'Patient',  text: "About a week after the antibiotics. They've resolved now but I'm worried about what's next." },
    { t: '00:47', who: 'Provider', text: 'Okay. And the wrist — you mentioned the hardware is bothering you?' },
    { t: '00:55', who: 'Patient',  text: "Yeah. It's been about two years and I think I want it out. I can feel the plate when I lean on it." },
    { t: '01:12', who: 'Provider', text: "Let's get a referral back to Dr. Knutsen at UC Health since he placed it." },
    { t: '01:24', who: 'Patient',  text: "That'd be great. I also wanted to talk about… everything else." },
    { t: '01:31', who: 'Provider', text: "Of course. What's on your mind?" },
    { t: '01:33', who: 'Patient',  text: "Executive dysfunction is really bad. I'm trying to do Grubhub gig work and I literally can't make myself do it without physical pain." },
    { t: '01:48', who: 'Provider', text: 'Tell me more about the pain.' },
    { t: '01:51', who: 'Patient',  text: 'Stabbing pains in my arms, legs, chest. When I try to push through it gets worse. Last few months it has been worse.' },
    { t: '02:08', who: 'Provider', text: "Have you been able to connect with a therapist?" },
    { t: '02:13', who: 'Patient',  text: "Just started with a new one. Seeing them Monday." },
    { t: '02:18', who: 'Provider', text: "Good. Let's also do the MDQ and an ADHD screen today. I'd like to start L-methylfolate to support things while we figure out medication." },
    { t: '02:36', who: 'Patient',  text: 'Okay. I want to have something on hand in case the therapist thinks I should start.' },
    { t: '02:44', who: 'Provider', text: "I'll send Viibryd at a low dose so you have it available. We'll check in 1–2 weeks." },
  ],
};

// Smaller mock encounters for the list (varying status states).
const OTHER_ENCOUNTERS = [
  {
    id: 'enc_002',
    patient: { id: 'demo-patient-002', name: 'demo-patient-002' },
    encounterId: 'demo-encounter-apr-9-at-1-26-pm',
    department: 'Department 1',
    provider: 'Dr. Aldana',
    receivedAt: '2026-05-13T09:21:56-06:00',
    audioDurationSec: 612,
    transcriptWordCount: 1480,
    status: STATUS.SENT,
    approvals: { hpi: true, plan: true, exam: true, labs: true },
    sentAt: '2026-05-13T09:18:14-06:00',
  },
  {
    id: 'enc_003',
    patient: { id: 'demo-patient-003', name: 'demo-patient-003' },
    encounterId: 'demo-encounter-apr-9-at-11-14-am',
    department: 'Department 1',
    provider: 'Dr. Park',
    receivedAt: '2026-05-13T09:22:29-06:00',
    audioDurationSec: 845,
    transcriptWordCount: 2104,
    status: STATUS.SENT,
    approvals: { hpi: true, plan: true, exam: true, labs: true },
    sentAt: '2026-05-13T09:14:00-06:00',
  },
  {
    id: 'enc_004',
    patient: { id: 'demo-patient-004', name: 'demo-patient-004' },
    encounterId: 'demo-encounter-apr-9-at-12-35-pm',
    department: 'Department 2',
    provider: 'Dr. Aldana',
    receivedAt: '2026-05-13T09:22:55-06:00',
    audioDurationSec: 423,
    transcriptWordCount: 980,
    status: STATUS.EHR_FAILED,
    approvals: { hpi: true, plan: true, exam: true, labs: true },
    ehrError: 'EHR responded 503 (Service Unavailable) — last retry 2 minutes ago.',
  },
  {
    id: 'enc_005',
    patient: { id: 'demo-patient-005', name: 'demo-patient-005' },
    encounterId: 'demo-encounter-apr-9-at-9-50-am',
    department: 'Department 1',
    provider: 'Dr. Knutsen',
    receivedAt: '2026-05-13T09:23:34-06:00',
    audioDurationSec: 712,
    transcriptWordCount: 1820,
    status: STATUS.EXTRACTING,
    approvals: { hpi: false, plan: false, exam: false, labs: false },
    pipelineProgress: 0.74,
  },
  {
    id: 'enc_006',
    patient: { id: 'demo-patient-006', name: 'demo-patient-006' },
    encounterId: 'demo-encounter-apr-9-at-8-12-am',
    department: 'Department 1',
    provider: 'Dr. Park',
    receivedAt: '2026-05-13T09:25:01-06:00',
    audioDurationSec: 1102,
    transcriptWordCount: 0,
    status: STATUS.TRANSCRIBING,
    approvals: { hpi: false, plan: false, exam: false, labs: false },
    pipelineProgress: 0.41,
  },
  {
    id: 'enc_007',
    patient: { id: 'demo-patient-007', name: 'demo-patient-007' },
    encounterId: 'demo-encounter-apr-8-at-4-04-pm',
    department: 'Department 2',
    provider: 'Dr. Aldana',
    receivedAt: '2026-05-13T09:26:10-06:00',
    audioDurationSec: 0,
    transcriptWordCount: 0,
    status: STATUS.QUEUED,
    approvals: { hpi: false, plan: false, exam: false, labs: false },
  },
  {
    id: 'enc_008',
    patient: { id: 'demo-patient-008', name: 'demo-patient-008' },
    encounterId: 'demo-encounter-apr-8-at-2-50-pm',
    department: 'Department 1',
    provider: 'Dr. Knutsen',
    receivedAt: '2026-05-13T09:27:45-06:00',
    audioDurationSec: 318,
    transcriptWordCount: 0,
    status: STATUS.FAILED,
    approvals: { hpi: false, plan: false, exam: false, labs: false },
    error: 'AWS HealthScribe returned MEDIA_QUALITY_TOO_LOW — audio level below threshold for first 4 minutes.',
  },
  {
    id: 'enc_009',
    patient: { id: 'demo-patient-009', name: 'demo-patient-009' },
    encounterId: 'demo-encounter-apr-8-at-1-30-pm',
    department: 'Department 1',
    provider: 'Dr. Park',
    receivedAt: '2026-05-13T09:28:22-06:00',
    audioDurationSec: 532,
    transcriptWordCount: 1340,
    status: STATUS.READY,
    approvals: { hpi: true, plan: false, exam: false, labs: false },
  },
  {
    id: 'enc_010',
    patient: { id: 'demo-patient-010', name: 'demo-patient-010' },
    encounterId: 'demo-encounter-apr-8-at-11-05-am',
    department: 'Department 2',
    provider: 'Dr. Aldana',
    receivedAt: '2026-05-13T09:30:00-06:00',
    audioDurationSec: 925,
    transcriptWordCount: 2240,
    status: STATUS.READY,
    approvals: { hpi: false, plan: false, exam: false, labs: false },
  },
];

const ENCOUNTERS = [ENCOUNTER_001, ...OTHER_ENCOUNTERS];

// Stats for the dashboard strip.
const DASHBOARD_STATS = {
  todayTotal: 14,
  inPipeline: 3,
  awaitingReview: 3,
  sentToEhr: 8,
  needsAttention: 2,
  avgTurnaroundMin: 11,
  approvalRate: 0.94,
};

// Note categories.
const NOTE_CATEGORIES = [
  { id: 'missed_info',  label: 'Missed info',         color: 'attention', icon: 'circle-help'    },
  { id: 'incorrect',    label: 'Incorrect extraction',color: 'error',     icon: 'circle-x'       },
  { id: 'hallucination',label: 'Hallucination',       color: 'error',     icon: 'flame'          },
  { id: 'formatting',   label: 'Formatting',          color: 'warning',   icon: 'align-left'     },
  { id: 'good',         label: 'Good output',         color: 'success',   icon: 'thumbs-up'      },
  { id: 'comment',      label: 'General comment',     color: 'neutral',   icon: 'message-square' },
];

Object.assign(window, { STATUS, ENCOUNTERS, DASHBOARD_STATS, NOTE_CATEGORIES });
