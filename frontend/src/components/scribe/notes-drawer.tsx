import { useEffect, useState } from "react";
import { MessageSquare, MessageSquareDashed, Send, X } from "lucide-react";
import type {
  FeedbackNote,
  NoteCategoryId,
  NoteTarget,
  SectionKey,
} from "./types";
import { NOTE_CATEGORIES } from "./status";
import { fmtRelative } from "./format";

const SECTION_LABELS: Record<NoteTarget, string> = {
  overall: "Whole encounter",
  hpi: "HPI",
  plan: "Assessment & Plan",
  exam: "Physical Exam",
  labs: "Diagnoses & Labs",
};

interface Props {
  open: boolean;
  notes: FeedbackNote[];
  onClose: () => void;
  onAddNote: (note: Omit<FeedbackNote, "id" | "at" | "author" | "authorInitials">) => void;
  defaultSection: SectionKey | null;
}

export function NotesDrawer({
  open,
  notes,
  onClose,
  onAddNote,
  defaultSection,
}: Props) {
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState<NoteCategoryId>("missed_info");
  const [target, setTarget] = useState<NoteTarget>(defaultSection ?? "overall");

  useEffect(() => {
    if (defaultSection) setTarget(defaultSection);
  }, [defaultSection]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleSubmit = () => {
    if (!draft.trim()) return;
    onAddNote({ category, section: target, body: draft.trim() });
    setDraft("");
  };

  return (
    <div className={`janus-notes-drawer ${open ? "open" : ""}`}>
      <div className="janus-notes-head">
        <MessageSquare className="janus-notes-head-icon" />
        <div style={{ flex: 1 }}>
          <h3>LLM Feedback</h3>
          <span className="janus-notes-sub">
            Notes train the extraction model · not part of the chart
          </span>
        </div>
        <button
          type="button"
          className="janus-icon-btn"
          onClick={onClose}
          title="Close"
          aria-label="Close feedback drawer"
        >
          <X />
        </button>
      </div>

      <div className="janus-notes-list">
        {notes.length === 0 ? (
          <div
            style={{
              padding: "24px 4px",
              color: "var(--janus-text-light)",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            <MessageSquareDashed
              style={{
                width: 28,
                height: 28,
                color: "var(--janus-border)",
                display: "inline-block",
                marginBottom: 10,
              }}
            />
            <div>No feedback yet for this encounter.</div>
            <div style={{ marginTop: 6, fontSize: 12 }}>
              Help the extraction model learn — flag what it missed, got wrong,
              or nailed.
            </div>
          </div>
        ) : (
          notes.map((n) => {
            const cat = NOTE_CATEGORIES.find((c) => c.id === n.category);
            const CatIcon = cat?.icon;
            return (
              <div key={n.id} className={`janus-note cat-${n.category}`}>
                <div className="janus-note-head">
                  <span className="janus-author-mark">{n.authorInitials}</span>
                  <span className="janus-author-name">{n.author}</span>
                  <span className="janus-note-time">· {fmtRelative(n.at)}</span>
                  <span className="janus-note-cat-tag">
                    {CatIcon ? <CatIcon /> : null}
                    {cat?.label}
                  </span>
                </div>
                {n.section && n.section !== "overall" ? (
                  <div className="janus-note-section">
                    In {SECTION_LABELS[n.section]}
                  </div>
                ) : null}
                <div className="janus-note-body">{n.body}</div>
              </div>
            );
          })
        )}
      </div>

      <div className="janus-note-composer">
        <div className="janus-composer-cats">
          {NOTE_CATEGORIES.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                type="button"
                className={`janus-composer-cat ${category === c.id ? "active" : ""}`}
                onClick={() => setCategory(c.id)}
              >
                <Icon />
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
        <div className="janus-composer-target">
          Target:
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
          className="janus-composer-input"
          placeholder="Describe what to fix or improve. Specific examples help the model most."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="janus-composer-actions">
          <button
            type="button"
            className="janus-btn janus-btn-ghost janus-btn-sm"
            onClick={() => setDraft("")}
          >
            Cancel
          </button>
          <button
            type="button"
            className="janus-btn janus-btn-primary janus-btn-sm"
            onClick={handleSubmit}
            disabled={!draft.trim()}
          >
            <Send />
            Post feedback
          </button>
        </div>
      </div>
    </div>
  );
}
