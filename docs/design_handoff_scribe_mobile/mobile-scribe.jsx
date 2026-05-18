// Mobile Scribe — phone-sized React components.
// Reuses scribe-data.js (STATUS, ENCOUNTERS, NOTE_CATEGORIES).

const { useState: useStateM, useEffect: useEffectM, useMemo: useMemoM, useRef: useRefM } = React;

// ── helpers ────────────────────────────────────────────────────────
const mFmtDuration = (sec) => {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};
const mFmtRelative = (iso) => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
};

function MStatusPill({ status, large }) {
  return (
    <span className={`m-status ${status.color} ${large ? 'lg' : ''}`}>
      <i data-lucide={status.icon}></i>
      <span>{status.label}</span>
    </span>
  );
}

function MAudioWave() {
  const bars = useMemoM(() => {
    const arr = [];
    for (let i = 0; i < 60; i++) {
      const v = Math.abs(Math.sin(i * 0.41) + Math.sin(i * 1.17) * 0.6 + Math.sin(i * 0.07) * 0.4);
      arr.push(0.2 + (v / 2) * 0.9);
    }
    return arr;
  }, []);
  return (
    <svg className="m-audio-wave" viewBox="0 0 240 24" preserveAspectRatio="none">
      {bars.map((h, i) => {
        const y = 12 - (h * 10);
        const played = i < 7;
        return (
          <rect key={i} x={i * 4} y={y} width="2.4" height={h * 20} rx="1.2"
            fill={played ? 'var(--primary-color)' : 'rgba(44,95,125,0.25)'} />
        );
      })}
    </svg>
  );
}

function MPipelineProgress({ status }) {
  const steps = [
    { id: 'queued',       label: 'Queued',       icon: 'inbox' },
    { id: 'transcribing', label: 'Transcribing', icon: 'mic' },
    { id: 'extracting',   label: 'Extracting',   icon: 'sparkles' },
    { id: 'ready',        label: 'Ready',        icon: 'circle-check' },
  ];
  const order = { queued: 0, transcribing: 1, extracting: 2, ready: 3, sent: 3, failed: -1, ehr_failed: 3 };
  const activeIdx = order[status.id];
  const fillPct = ((activeIdx) / (steps.length - 1)) * 100;
  return (
    <div className="m-pipeline">
      <div className="m-pipeline-lbl">Pipeline</div>
      <div className="m-pipeline-steps">
        <div className="m-pipeline-connector"><div className="fill" style={{ width: `${Math.max(0, fillPct)}%` }}></div></div>
        {steps.map((s, i) => {
          const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'idle';
          return (
            <div key={s.id} className={`m-pipeline-step ${state}`}>
              <div className="dot">
                {state === 'done' ? <i data-lucide="check"></i> : <i data-lucide={s.icon}></i>}
              </div>
              <span>{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── List view ──────────────────────────────────────────────────────
function MListView({ encounters, selectedId, onSelect, statusFilter, onStatusFilter, onBack }) {
  const counts = useMemoM(() => ({
    all: encounters.length,
    ready: encounters.filter(e => e.status.id === 'ready').length,
    in_pipeline: encounters.filter(e => ['queued','transcribing','extracting'].includes(e.status.id)).length,
    sent: encounters.filter(e => e.status.id === 'sent').length,
    attention: encounters.filter(e => ['failed','ehr_failed'].includes(e.status.id)).length,
  }), [encounters]);

  const filtered = encounters.filter(e => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'ready') return e.status.id === 'ready';
    if (statusFilter === 'in_pipeline') return ['queued','transcribing','extracting'].includes(e.status.id);
    if (statusFilter === 'sent') return e.status.id === 'sent';
    if (statusFilter === 'attention') return ['failed','ehr_failed'].includes(e.status.id);
    return true;
  });

  const filters = [
    { id: 'all',         label: 'All' },
    { id: 'ready',       label: 'Ready',         icon: 'circle-dot' },
    { id: 'in_pipeline', label: 'In pipeline',   icon: 'loader' },
    { id: 'sent',        label: 'Sent',          icon: 'check' },
    { id: 'attention',   label: 'Attn',          icon: 'triangle-alert' },
  ];

  return (
    <>
      <div className="m-topbar with-back">
        {onBack ? (
          <button className="m-back" onClick={onBack}>
            <i data-lucide="chevron-left"></i>
            <span>Home</span>
          </button>
        ) : null}
        <div className="m-brand">
          <div className="m-brand-mark">J</div>
          <div className="m-brand-text">
            <span className="brand">Janus</span>
            <span className="module">Inbox</span>
          </div>
        </div>
        <div className="m-topbar-actions">
          <button className="m-icon-btn"><i data-lucide="search"></i></button>
          <button className="m-icon-btn">
            <i data-lucide="bell"></i>
            <span className="badge-dot"></span>
          </button>
        </div>
      </div>

      <div className="m-body">
        <div className="m-stats-row">
          <div className="m-stat-chip">
            <div className="lbl"><i data-lucide="calendar-days"></i>Today</div>
            <div className="val">{counts.all}</div>
          </div>
          <div className="m-stat-chip attention">
            <div className="lbl"><i data-lucide="circle-dot"></i>Ready</div>
            <div className="val">{counts.ready}</div>
          </div>
          <div className="m-stat-chip">
            <div className="lbl"><i data-lucide="loader"></i>Pipeline</div>
            <div className="val">{counts.in_pipeline}</div>
          </div>
          <div className="m-stat-chip">
            <div className="lbl"><i data-lucide="check-check"></i>Sent</div>
            <div className="val">{counts.sent}</div>
          </div>
          <div className="m-stat-chip alert">
            <div className="lbl"><i data-lucide="triangle-alert"></i>Attn</div>
            <div className="val">{counts.attention}</div>
          </div>
        </div>

        <div className="m-filter-row">
          {filters.map(f => (
            <button key={f.id}
              className={`m-chip ${statusFilter === f.id ? 'active' : ''}`}
              onClick={() => onStatusFilter(f.id)}
            >
              {f.icon ? <i data-lucide={f.icon}></i> : null}
              <span>{f.label}</span>
              <span className="chip-count">{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="m-list-meta">
          <span>{filtered.length} encounter{filtered.length === 1 ? '' : 's'}</span>
          <span>Newest first</span>
        </div>

        <div className="m-session-list">
          {filtered.length === 0 ? (
            <div className="m-empty">
              <i data-lucide="inbox"></i>
              <div>No encounters match that filter.</div>
            </div>
          ) : filtered.map(enc => (
            <div key={enc.id}
              className={`m-row ${selectedId === enc.id ? 'selected' : ''}`}
              onClick={() => onSelect(enc.id)}
            >
              <div className="m-row-top">
                <div className="m-row-patient">{enc.patient.name}</div>
                <MStatusPill status={enc.status} />
              </div>
              <div className="m-row-enc">{enc.encounterId}</div>
              <div className="m-row-meta">
                <span><i data-lucide="clock"></i>{mFmtDuration(enc.audioDurationSec)}</span>
                {enc.transcriptWordCount ? (
                  <span><i data-lucide="file-text"></i>{enc.transcriptWordCount.toLocaleString()} w</span>
                ) : null}
                <span style={{ marginLeft: 'auto' }}>{mFmtRelative(enc.receivedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Section card ───────────────────────────────────────────────────
function MSectionCard({ section, approved, noteCount, onApprove, onAddNote, children }) {
  return (
    <div className={`m-section ${approved ? 'approved' : ''} ${noteCount > 0 ? 'has-notes' : ''}`}>
      <div className="m-section-head">
        <div className="m-section-icon"><i data-lucide={section.icon}></i></div>
        <div className="m-section-title">{section.title}</div>
        <div className="m-section-head-actions">
          <button className="m-section-action" onClick={onAddNote} title="Feedback">
            <i data-lucide="message-square"></i>
            {noteCount > 0 ? <span className="note-pip">{noteCount}</span> : null}
          </button>
        </div>
      </div>
      <div className="m-section-body">{children}</div>
      <div className="m-approve-bar">
        <button className={`m-approve-btn ${approved ? 'done' : ''}`} onClick={onApprove}>
          <i data-lucide={approved ? 'check-circle-2' : 'circle'}></i>
          {approved ? 'Approved' : 'Approve section'}
        </button>
      </div>
    </div>
  );
}

function MTranscriptCard({ encounter, defaultOpen }) {
  const [open, setOpen] = useStateM(!!defaultOpen);
  if (!encounter.transcript) return null;
  return (
    <div className="m-transcript">
      <button className={`m-transcript-toggle ${open ? 'open' : ''}`} onClick={() => setOpen(o => !o)}>
        <i data-lucide="chevron-right" className="caret"></i>
        <span>Transcript</span>
        <span className="wc">{encounter.transcriptWordCount.toLocaleString()} w · {encounter.transcript.length} turns</span>
      </button>
      {open ? (
        <div className="m-transcript-body">
          {encounter.transcript.map((line, i) => (
            <div key={i} className={`m-transcript-line ${line.who.toLowerCase()}`}>
              <span className="t">{line.t}</span>
              <span className="who">{line.who}</span>
              <span>{line.text}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Detail view ────────────────────────────────────────────────────
function MDetailView({
  encounter, approvals, onBack, onApprove, onApproveAll, onSendToEHR,
  onOpenNotes, onAddNoteForSection, notesForSection, transcriptDefaultOpen,
}) {
  const isReady = encounter.status.id === 'ready';
  const isSent = encounter.status.id === 'sent';
  const isFailed = encounter.status.id === 'failed';
  const isEhrFailed = encounter.status.id === 'ehr_failed';
  const isInPipeline = ['queued', 'transcribing', 'extracting'].includes(encounter.status.id);

  const approvedCount = Object.values(approvals).filter(Boolean).length;
  const allApproved = approvedCount === 4;
  const totalNotes = encounter.notes ? encounter.notes.length : 0;

  return (
    <>
      <div className="m-detail-topbar">
        <button className="m-back" onClick={onBack}>
          <i data-lucide="chevron-left"></i>
          <span>Inbox</span>
        </button>
        <div className="title">{encounter.patient.name}</div>
        <button className="m-icon-btn"><i data-lucide="more-horizontal"></i></button>
      </div>

      <div className="m-body">
        <div className="m-detail-head">
          <div className="m-detail-titlerow">
            <div>
              <h2 className="m-patient-name">{encounter.patient.name}</h2>
              <p className="m-patient-sub">{encounter.encounterId}</p>
            </div>
            <MStatusPill status={encounter.status} large />
          </div>
          <div className="m-detail-meta">
            <span><i data-lucide="user-round"></i>{encounter.provider}</span>
            <span><i data-lucide="building-2"></i>{encounter.department}</span>
            <span><i data-lucide="clock"></i>{mFmtDuration(encounter.audioDurationSec)}</span>
            {encounter.transcriptWordCount > 0 ? (
              <span><i data-lucide="file-text"></i>{encounter.transcriptWordCount.toLocaleString()} w</span>
            ) : null}
          </div>
        </div>

        {encounter.sections ? (
          <div className="m-audio">
            <button className="m-audio-play"><i data-lucide="play"></i></button>
            <MAudioWave />
            <span className="m-audio-time">0:48 / {mFmtDuration(encounter.audioDurationSec)}</span>
          </div>
        ) : null}

        {isInPipeline ? <MPipelineProgress status={encounter.status} /> : null}

        {isFailed ? (
          <div className="m-banner">
            <i data-lucide="triangle-alert"></i>
            <div>
              <strong>Transcription failed</strong>
              {encounter.error}
              <div>
                <button className="m-banner-retry"><i data-lucide="refresh-ccw"></i>Retry pipeline</button>
              </div>
            </div>
          </div>
        ) : null}

        {isEhrFailed ? (
          <div className="m-banner warning">
            <i data-lucide="cloud-alert"></i>
            <div>
              <strong>EHR sync failed — content approved</strong>
              {encounter.ehrError}
              <div>
                <button className="m-banner-retry"><i data-lucide="refresh-ccw"></i>Retry sync</button>
              </div>
            </div>
          </div>
        ) : null}

        {encounter.sections ? (
          <>
            <div className="m-approval-bar">
              <span><strong>{approvedCount}</strong> of 4 approved</span>
              <div className="m-approval-pips">
                {['hpi', 'plan', 'exam', 'labs'].map(k => (
                  <div key={k} className={`m-approval-pip ${approvals[k] ? 'done' : ''}`}></div>
                ))}
              </div>
              <button className="m-approval-feedback" onClick={onOpenNotes}>
                <i data-lucide="message-square"></i>
                {totalNotes > 0 ? <span className="count-dot">{totalNotes}</span> : <span>Feedback</span>}
              </button>
            </div>

            <div className="m-sections">
              <MSectionCard section={encounter.sections.hpi}
                approved={approvals.hpi}
                noteCount={notesForSection('hpi')}
                onApprove={() => onApprove('hpi')}
                onAddNote={() => onAddNoteForSection('hpi')}
              >
                <p>{encounter.sections.hpi.body}</p>
              </MSectionCard>
              <MSectionCard section={encounter.sections.plan}
                approved={approvals.plan}
                noteCount={notesForSection('plan')}
                onApprove={() => onApprove('plan')}
                onAddNote={() => onAddNoteForSection('plan')}
              >
                <ol className="m-plan-list">
                  {encounter.sections.plan.body.map((l, i) => <li key={i}>{l}</li>)}
                </ol>
              </MSectionCard>
              <MSectionCard section={encounter.sections.exam}
                approved={approvals.exam}
                noteCount={notesForSection('exam')}
                onApprove={() => onApprove('exam')}
                onAddNote={() => onAddNoteForSection('exam')}
              >
                <div className="m-exam">{encounter.sections.exam.body}</div>
              </MSectionCard>
              <MSectionCard section={encounter.sections.labs}
                approved={approvals.labs}
                noteCount={notesForSection('labs')}
                onApprove={() => onApprove('labs')}
                onAddNote={() => onAddNoteForSection('labs')}
              >
                <table className="m-labs">
                  <tbody>
                    {encounter.sections.labs.body.map((row, i) => {
                      const m = row.dx.match(/^(.+) \(([A-Z0-9.]+)\)$/);
                      const name = m ? m[1] : row.dx;
                      const code = m ? m[2] : null;
                      return (
                        <tr key={i}>
                          <td>{name}{code ? <span className="m-dx-code">{code}</span> : null}</td>
                          <td>{row.detail}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </MSectionCard>
              <MTranscriptCard encounter={encounter} defaultOpen={transcriptDefaultOpen} />
            </div>
          </>
        ) : (
          <div className="m-empty" style={{ paddingTop: 80 }}>
            <i data-lucide="clock"></i>
            <div>Structured output will appear here once the pipeline completes.</div>
          </div>
        )}
      </div>

      {encounter.sections ? (
        <div className="m-bottom-bar">
          {!allApproved && !isSent ? (
            <button className="m-send-secondary" onClick={onApproveAll}>Approve all</button>
          ) : null}
          <button
            className="m-send"
            disabled={!allApproved || isSent}
            onClick={onSendToEHR}
          >
            <i data-lucide={isSent ? 'check' : 'send'}></i>
            {isSent ? 'Sent to EHR' : 'Send to EHR'}
          </button>
        </div>
      ) : null}
    </>
  );
}

// ── Feedback sheet ─────────────────────────────────────────────────
function MNotesSheet({ open, encounter, onClose, onAddNote, defaultSection }) {
  const [draft, setDraft] = useStateM('');
  const [category, setCategory] = useStateM('missed_info');
  const [target, setTarget] = useStateM(defaultSection || 'overall');

  useEffectM(() => { if (defaultSection) setTarget(defaultSection); }, [defaultSection]);

  if (!encounter) return null;
  const notes = encounter.notes || [];

  const handleSubmit = () => {
    if (!draft.trim()) return;
    onAddNote({ category, section: target, body: draft.trim() });
    setDraft('');
  };

  const targetLabel = {
    overall: 'Whole encounter', hpi: 'HPI', plan: 'Assessment & Plan',
    exam: 'Physical Exam', labs: 'Diagnoses & Labs',
  };

  return (
    <>
      <div className={`m-sheet-scrim ${open ? 'open' : ''}`} onClick={onClose}></div>
      <div className={`m-sheet ${open ? 'open' : ''}`}>
        <div className="m-sheet-handle"></div>
        <div className="m-sheet-head">
          <i data-lucide="message-square" style={{ fontSize: 18, color: 'var(--primary-color)' }}></i>
          <div style={{ flex: 1 }}>
            <h3>LLM Feedback</h3>
            <span className="sub">Notes train the model · not part of the chart</span>
          </div>
          <button className="m-sheet-close" onClick={onClose}><i data-lucide="x"></i></button>
        </div>

        <div className="m-sheet-body">
          <div className="m-notes-list">
            {notes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-light)', fontSize: 12 }}>
                No feedback yet. Help the model learn — flag missed info, hallucinations, or what it got right.
              </div>
            ) : notes.map(n => {
              const cat = NOTE_CATEGORIES.find(c => c.id === n.category) || {};
              return (
                <div key={n.id} className={`m-note cat-${n.category}`}>
                  <div className="m-note-head">
                    <span className="author-mark">{n.authorInitials}</span>
                    <span className="author-name">{n.author}</span>
                    <span className="note-time">· {mFmtRelative(n.at)}</span>
                    <span className="m-note-tag">
                      <i data-lucide={cat.icon}></i>{cat.label}
                    </span>
                  </div>
                  {n.section && n.section !== 'overall' ? (
                    <div className="m-note-target">In {targetLabel[n.section] || n.section}</div>
                  ) : null}
                  <div className="m-note-body">{n.body}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="m-composer">
          <div className="m-cat-row">
            {NOTE_CATEGORIES.map(c => (
              <button key={c.id}
                className={`m-cat-chip ${category === c.id ? 'active' : ''}`}
                onClick={() => setCategory(c.id)}
              >
                <i data-lucide={c.icon}></i>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
          <div className="m-target-row">
            <span>Target:</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="overall">Whole encounter</option>
              <option value="hpi">HPI</option>
              <option value="plan">Assessment & Plan</option>
              <option value="exam">Physical Exam</option>
              <option value="labs">Diagnoses & Labs</option>
            </select>
          </div>
          <textarea
            placeholder="Describe what to fix or improve. Specific examples help most."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="m-composer-actions">
            <button className="m-btn-ghost" onClick={() => setDraft('')}>Cancel</button>
            <button className="m-btn-primary" disabled={!draft.trim()} onClick={handleSubmit}>
              <i data-lucide="send"></i>Post
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Home / Quickstart ──────────────────────────────────────────────
function MHomeView({ encounters, onRecord, onOpenInbox, onOpenEncounter }) {
  const counts = useMemoM(() => ({
    ready:    encounters.filter(e => e.status.id === 'ready').length,
    pipeline: encounters.filter(e => ['queued','transcribing','extracting'].includes(e.status.id)).length,
    sent:     encounters.filter(e => e.status.id === 'sent').length,
    attn:     encounters.filter(e => ['failed','ehr_failed'].includes(e.status.id)).length,
    all:      encounters.length,
  }), [encounters]);

  // Recent activity: most-recently-touched encounters, regardless of status,
  // newest first. Limit to 4 so the page stays scannable on a phone.
  const recent = useMemoM(() => {
    return [...encounters]
      .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
      .slice(0, 4);
  }, [encounters]);

  const recentLine = (e) => {
    if (e.status.id === 'sent')        return `Sent to EHR · ${mFmtRelative(e.sentAt || e.receivedAt)}`;
    if (e.status.id === 'ready')       return `Ready for review · ${mFmtRelative(e.receivedAt)}`;
    if (e.status.id === 'failed')      return `Failed · needs attention`;
    if (e.status.id === 'ehr_failed')  return `EHR sync failed · ${mFmtRelative(e.receivedAt)}`;
    return `${e.status.label} · ${mFmtRelative(e.receivedAt)}`;
  };

  const recentIconClass = (e) => {
    if (e.status.id === 'sent') return 'success';
    if (e.status.id === 'ready') return 'attention';
    if (e.status.id === 'failed' || e.status.id === 'ehr_failed') return 'error';
    return 'progress';
  };
  const recentIcon = (e) => {
    if (e.status.id === 'sent') return 'check';
    if (e.status.id === 'ready') return 'circle-dot';
    if (e.status.id === 'failed' || e.status.id === 'ehr_failed') return 'triangle-alert';
    if (e.status.id === 'transcribing') return 'mic';
    if (e.status.id === 'extracting') return 'sparkles';
    return 'inbox';
  };

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <>
      <div className="m-topbar">
        <div className="m-brand">
          <div className="m-brand-mark">J</div>
          <div className="m-brand-text">
            <span className="brand">Janus</span>
            <span className="module">Scribe</span>
          </div>
        </div>
        <div className="m-topbar-actions">
          <button className="m-icon-btn">
            <i data-lucide="bell"></i>
            {counts.attn > 0 ? <span className="badge-dot"></span> : null}
          </button>
          <button className="m-icon-btn"><i data-lucide="user-round"></i></button>
        </div>
      </div>

      <div className="m-body">
        <div className="m-home-greet">
          <span className="greet-lbl">{greeting},</span>
          <span className="greet-name">Dr. Aldana</span>
          <span className="greet-date">{dateStr}</span>
        </div>

        <button className="m-home-cta" onClick={onRecord}>
          <div className="cta-row">
            <div className="cta-mic"><i data-lucide="mic"></i></div>
            <div className="cta-text">
              <span className="cta-title">Record a session</span>
              <span className="cta-sub">Saved on device, uploaded when synced</span>
            </div>
            <i data-lucide="chevron-right" className="cta-arrow"></i>
          </div>
        </button>

        {counts.ready > 0 ? (
          <button className="m-shortcut-card" onClick={() => onOpenInbox('ready')}>
            <span className="shortcut-num">{counts.ready}</span>
            <div className="shortcut-body">
              <span className="shortcut-title">Sessions ready for your review</span>
              <span className="shortcut-sub">Approve sections and send to EHR</span>
            </div>
            <i data-lucide="chevron-right" className="shortcut-arrow"></i>
          </button>
        ) : (
          <div className="m-shortcut-card empty">
            <span className="shortcut-num">0</span>
            <div className="shortcut-body">
              <span className="shortcut-title">You're all caught up</span>
              <span className="shortcut-sub">No sessions awaiting review</span>
            </div>
          </div>
        )}

        {counts.attn > 0 ? (
          <button className="m-shortcut-card alert" onClick={() => onOpenInbox('attention')}>
            <span className="shortcut-num">{counts.attn}</span>
            <div className="shortcut-body">
              <span className="shortcut-title">Sessions need attention</span>
              <span className="shortcut-sub">Failed transcription or EHR sync</span>
            </div>
            <i data-lucide="chevron-right" className="shortcut-arrow"></i>
          </button>
        ) : null}

        <div className="m-section-lbl">Today</div>
        <div className="m-tiles">
          <button className="m-tile progress" onClick={() => onOpenInbox('in_pipeline')}>
            <div className="tile-icon"><i data-lucide="loader"></i></div>
            <span className="tile-num">{counts.pipeline}</span>
            <span className="tile-lbl">In pipeline</span>
          </button>
          <button className="m-tile" onClick={() => onOpenInbox('sent')}>
            <div className="tile-icon"><i data-lucide="check-check"></i></div>
            <span className="tile-num">{counts.sent}</span>
            <span className="tile-lbl">Sent to EHR</span>
          </button>
        </div>

        <div className="m-section-lbl">Recent</div>
        <div className="m-recent-list">
          {recent.map(e => (
            <div key={e.id} className="m-recent-row" onClick={() => onOpenEncounter(e.id)}>
              <div className={`m-recent-icon ${recentIconClass(e)}`}>
                <i data-lucide={recentIcon(e)}></i>
              </div>
              <div className="m-recent-body">
                <div className="m-recent-name">{e.patient.name}</div>
                <div className="m-recent-sub">{recentLine(e)}</div>
              </div>
              <i data-lucide="chevron-right" className="m-recent-chev"></i>
            </div>
          ))}
        </div>

        <div style={{ height: 24 }}></div>

        <button
          onClick={() => onOpenInbox('all')}
          style={{
            display: 'block',
            margin: '0 auto 16px',
            background: 'transparent',
            border: 'none',
            color: 'var(--primary-color)',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          View full inbox ({counts.all}) →
        </button>
      </div>
    </>
  );
}

// ── Record flow ────────────────────────────────────────────────────
// Three sub-states: 'idle' | 'recording' | 'review' | 'uploading'
function MRecordView({ onBack, onSaved, defaultPatientId, defaultDepartment }) {
  const [phase, setPhase] = useStateM('idle');
  const [patientId, setPatientId] = useStateM(defaultPatientId || 'demo-patient-011');
  const [department, setDepartment] = useStateM(defaultDepartment || 'Department 1');
  const [seconds, setSeconds] = useStateM(0);
  const timerRef = useRefM(null);

  useEffectM(() => {
    if (phase === 'recording') {
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [phase]);

  // Auto-advance after upload animation.
  useEffectM(() => {
    if (phase === 'uploading') {
      const t = setTimeout(() => onSaved({ patientId, department, seconds }), 2200);
      return () => clearTimeout(t);
    }
  }, [phase, patientId, department, seconds, onSaved]);

  const fmt = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;

  return (
    <>
      <div className="m-detail-topbar">
        <button className="m-back" onClick={onBack}>
          <i data-lucide="chevron-left"></i>
          <span>Home</span>
        </button>
        <div className="title">
          {phase === 'idle'      ? 'New session' :
           phase === 'recording' ? 'Recording…'   :
           phase === 'review'    ? 'Review recording' :
                                   'Saving'}
        </div>
        <span style={{ width: 38 }}></span>
      </div>

      <div className="m-record-stage">
        {phase === 'idle' ? (
          <>
            <div className="m-record-form">
              <label className="field-label">Patient</label>
              <input
                className="field"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="Patient ID"
              />
              <label className="field-label">Department</label>
              <select
                className="field"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option>Department 1</option>
                <option>Department 2</option>
              </select>
            </div>
            <div className="m-record-center">
              <button className="m-rec-btn" onClick={() => { setSeconds(0); setPhase('recording'); }}>
                <i data-lucide="mic"></i>
              </button>
              <div className="m-rec-hint">Tap to start recording</div>
              <div className="m-rec-detail">
                Audio is saved on your device first. It uploads to S3 in the background, then is transcribed and extracted automatically.
              </div>
            </div>
          </>
        ) : null}

        {phase === 'recording' ? (
          <div className="m-record-center">
            <div className="m-rec-timer">{fmt(seconds)}</div>
            <div className="m-rec-meta">
              <span className="rec-dot"></span>
              <span>Recording · {patientId}</span>
            </div>
            <RecordingWave />
            <button className="m-rec-btn recording" onClick={() => setPhase('review')}>
              <span className="rec-square"></span>
            </button>
            <div className="m-rec-detail">Tap the square to stop. You'll be able to play it back before saving.</div>
          </div>
        ) : null}

        {phase === 'review' ? (
          <>
            <div className="m-record-center">
              <div className="m-saved-check"><i data-lucide="check"></i></div>
              <div className="m-saved-title">Recorded {fmt(seconds || 222)}</div>
              <div className="m-rec-detail">
                {patientId} · {department}<br />
                Saved on device. Ready to queue for transcription.
              </div>
              <div className="m-audio" style={{ width: '90%', margin: '8px auto 0' }}>
                <button className="m-audio-play"><i data-lucide="play"></i></button>
                <MAudioWave />
                <span className="m-audio-time">0:00 / {fmt(seconds || 222)}</span>
              </div>
            </div>
            <div className="m-record-actions">
              <button className="m-send" onClick={() => setPhase('uploading')}>
                <i data-lucide="upload-cloud"></i>
                Save & queue for processing
              </button>
              <div className="btn-row">
                <button className="m-send-secondary" onClick={() => { setSeconds(0); setPhase('recording'); }}>
                  Re-record
                </button>
                <button className="m-send-secondary" style={{ color: 'var(--error-text)', borderColor: 'var(--error-border)' }} onClick={onBack}>
                  Discard
                </button>
              </div>
            </div>
          </>
        ) : null}

        {phase === 'uploading' ? (
          <div className="m-record-center">
            <div className="m-saved-check" style={{ borderColor: 'var(--primary-color)', background: 'rgba(74,144,164,0.12)', color: 'var(--primary-color)' }}>
              <i data-lucide="upload-cloud"></i>
            </div>
            <div className="m-saved-title">Uploading…</div>
            <div className="m-upload-progress"><div className="bar"></div></div>
            <div className="m-rec-detail">
              {patientId} · {fmt(seconds || 222)}<br />
              Once uploaded, transcription will start automatically.
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

// Live waveform during recording — bars animate.
function RecordingWave() {
  const [tick, setTick] = useStateM(0);
  useEffectM(() => {
    const id = setInterval(() => setTick(t => t + 1), 110);
    return () => clearInterval(id);
  }, []);
  const bars = [];
  const n = 36;
  for (let i = 0; i < n; i++) {
    const phase = (tick * 0.4) + i * 0.6;
    const h = 0.15 + Math.abs(Math.sin(phase) * 0.45 + Math.sin(phase * 1.7) * 0.25);
    bars.push(h);
  }
  return (
    <svg className="m-rec-wave" viewBox={`0 0 ${n * 7} 60`} preserveAspectRatio="none">
      {bars.map((h, i) => {
        const barH = h * 50;
        return (
          <rect key={i} x={i * 7 + 1} y={30 - barH/2} width="4" height={barH} rx="2"
            fill={i % 3 === 0 ? '#DC2626' : 'rgba(220,38,38,0.55)'} />
        );
      })}
    </svg>
  );
}

// ── App wrapper (state for one phone) ──────────────────────────────
function MobileScribeApp({
  initialView = 'home',
  initialEncounterId = null,
  initialStatusFilter = 'all',
  initialNotesOpen = false,
  initialNotesSection = null,
  initialRecordPhase = null,
  encountersSeed = ENCOUNTERS,
  transcriptDefaultOpen = false,
}) {
  const [view, setView] = useStateM(initialView);
  const [encounters, setEncounters] = useStateM(encountersSeed);
  const [selectedId, setSelectedId] = useStateM(initialEncounterId || encountersSeed[0].id);
  const [statusFilter, setStatusFilter] = useStateM(initialStatusFilter);
  const [notesOpen, setNotesOpen] = useStateM(initialNotesOpen);
  const [notesDefaultSection, setNotesDefaultSection] = useStateM(initialNotesSection);

  // Re-init Lucide icons on every render so newly-mounted icons hydrate.
  useEffectM(() => { if (window.lucide) window.lucide.createIcons(); });

  const selected = encounters.find(e => e.id === selectedId);
  const approvals = selected ? selected.approvals : { hpi: false, plan: false, exam: false, labs: false };

  const update = (id, patch) =>
    setEncounters(list => list.map(e => e.id === id ? (typeof patch === 'function' ? patch(e) : { ...e, ...patch }) : e));

  const onApprove = (k) => update(selectedId, e => ({ ...e, approvals: { ...e.approvals, [k]: !e.approvals[k] } }));
  const onApproveAll = () => update(selectedId, e => ({ ...e, approvals: { hpi: true, plan: true, exam: true, labs: true } }));
  const onSendToEHR = () => update(selectedId, e => ({ ...e, status: STATUS.SENT, sentAt: new Date().toISOString() }));

  const onAddNote = (note) => {
    const full = {
      id: `n_${Date.now()}`, author: 'Dr. Aldana', authorInitials: 'AA',
      at: new Date().toISOString(), ...note,
    };
    update(selectedId, e => ({ ...e, notes: [...(e.notes || []), full] }));
  };

  const notesForSection = (k) => {
    if (!selected || !selected.notes) return 0;
    return selected.notes.filter(n => n.section === k).length;
  };

  return (
    <div className="m-app">
      {view === 'home' ? (
        <MHomeView
          encounters={encounters}
          onRecord={() => setView('record')}
          onOpenInbox={(filter) => { setStatusFilter(filter); setView('list'); }}
          onOpenEncounter={(id) => { setSelectedId(id); setView('detail'); }}
        />
      ) : view === 'record' ? (
        <MRecordView
          onBack={() => setView('home')}
          onSaved={() => setView('home')}
        />
      ) : view === 'list' ? (
        <MListView
          encounters={encounters}
          selectedId={selectedId}
          onSelect={(id) => { setSelectedId(id); setView('detail'); }}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          onBack={() => setView('home')}
        />
      ) : (
        <MDetailView
          encounter={selected}
          approvals={approvals}
          onBack={() => setView('list')}
          onApprove={onApprove}
          onApproveAll={onApproveAll}
          onSendToEHR={onSendToEHR}
          onOpenNotes={() => { setNotesDefaultSection(null); setNotesOpen(true); }}
          onAddNoteForSection={(k) => { setNotesDefaultSection(k); setNotesOpen(true); }}
          notesForSection={notesForSection}
          transcriptDefaultOpen={transcriptDefaultOpen}
        />
      )}

      <MNotesSheet
        open={notesOpen}
        encounter={selected}
        onClose={() => setNotesOpen(false)}
        onAddNote={onAddNote}
        defaultSection={notesDefaultSection}
      />
    </div>
  );
}

Object.assign(window, { MobileScribeApp });
