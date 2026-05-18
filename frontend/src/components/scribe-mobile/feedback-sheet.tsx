import { useEffect, useState } from "react";
import { MessageSquare, Send, X } from "lucide-react";
import type {
  FeedbackNote,
  NoteCategoryId,
  NoteTarget,
} from "@/components/scribe/types";
import { NOTE_CATEGORIES } from "@/components/scribe/status";
import { fmtRelative } from "@/components/scribe/format";

interface Props {
  open: boolean;
  notes: FeedbackNote[];
  defaultSection: NoteTarget | null;
  onClose: () => void;
  onSubmit: (note: { category: NoteCategoryId; section: NoteTarget; body: string }) => void;
}

const TARGET_LABEL: Record<NoteTarget, string> = {
  overall: "Whole encounter",
  hpi: "HPI",
  plan: "Assessment & Plan",
  exam: "Physical Exam",
  labs: "Diagnoses & Labs",
};

export function MFeedbackSheet({
  open,
  notes,
  defaultSection,
  onClose,
  onSubmit,
}: Props) {
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState<NoteCategoryId>("missed_info");
  const [target, setTarget] = useState<NoteTarget>(defaultSection ?? "overall");

  useEffect(() => {
    if (open) {
      setTarget(defaultSection ?? "overall");
    }
  }, [open, defaultSection]);

  const handlePost = () => {
    const body = draft.trim();
    if (!body) return;
    onSubmit({ category, section: target, body });
    setDraft("");
  };

  return (
    <>
      <button
        type="button"
        className={`m-sheet-scrim ${open ? "open" : ""}`}
        aria-label="Close feedback"
        onClick={onClose}
        tabIndex={open ? 0 : -1}
      />
      <div
        className={`m-sheet ${open ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
      >
        <div className="m-sheet-handle" />
        <div className="m-sheet-head">
          <MessageSquare style={{ width: 18, height: 18, color: "var(--janus-primary)" }} />
          <div style={{ flex: 1 }}>
            <h3>LLM Feedback</h3>
            <span className="sub">Notes train the model · not part of the chart</span>
          </div>
          <button type="button" className="m-sheet-close" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>

        <div className="m-sheet-body">
          <div className="m-notes-list">
            {notes.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "20px 0",
                  color: "var(--janus-text-light)",
                  fontSize: 12,
                }}
              >
                No feedback yet. Help the model learn — flag missed info,
                hallucinations, or what it got right.
              </div>
            ) : (
              notes.map((n) => {
                const cat = NOTE_CATEGORIES.find((c) => c.id === n.category);
                const CatIcon = cat?.icon;
                return (
                  <div key={n.id} className={`m-note cat-${n.category}`}>
                    <div className="m-note-head">
                      <span className="author-mark">{n.authorInitials}</span>
                      <span className="author-name">{n.author}</span>
                      <span className="note-time">· {fmtRelative(n.at)}</span>
                      <span className="m-note-tag">
                        {CatIcon ? <CatIcon /> : null}
                        {cat?.label}
                      </span>
                    </div>
                    {n.section && n.section !== "overall" ? (
                      <div className="m-note-target">In {TARGET_LABEL[n.section]}</div>
                    ) : null}
                    <div className="m-note-body">{n.body}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="m-composer">
          <div className="m-cat-row">
            {NOTE_CATEGORIES.map((c) => {
              const Icon = c.icon;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`m-cat-chip ${category === c.id ? "active" : ""}`}
                  onClick={() => setCategory(c.id)}
                >
                  <Icon />
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
          <div className="m-target-row">
            <span>Target:</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as NoteTarget)}
            >
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
            <button type="button" className="m-btn-ghost" onClick={() => setDraft("")}>
              Cancel
            </button>
            <button
              type="button"
              className="m-btn-primary"
              disabled={!draft.trim()}
              onClick={handlePost}
            >
              <Send />
              Post
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
