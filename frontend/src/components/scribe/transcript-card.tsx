import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { wordCount } from "./status";

interface Props {
  transcript: string | undefined;
}

interface Turn {
  speaker: string;
  text: string;
}

// AWS HealthScribe and similar pipelines emit transcripts as
// `Speaker 0: ... Speaker 1: ...`. Split on those labels so we can render
// each turn as its own chat bubble. If no labels are found, fall back to a
// single block so we don't lose content.
function parseTurns(transcript: string): Turn[] {
  const re = /Speaker\s+(\d+|[A-Za-z]+)\s*:/g;
  const hits = Array.from(transcript.matchAll(re));
  if (hits.length === 0) return [];

  const turns: Turn[] = [];
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i]!;
    const next = hits[i + 1];
    const start = (cur.index ?? 0) + cur[0].length;
    const end = next ? next.index : undefined;
    const text = transcript.slice(start, end).trim();
    if (text) turns.push({ speaker: cur[1]!, text });
  }
  return turns;
}

export function TranscriptCard({ transcript }: Props) {
  const [open, setOpen] = useState(false);
  const turns = useMemo(
    () => (transcript ? parseTurns(transcript) : []),
    [transcript],
  );

  if (!transcript) {
    return (
      <div className="janus-transcript-card">
        <div
          className="janus-transcript-toggle"
          style={{ cursor: "default", color: "var(--janus-text-light)" }}
        >
          <ChevronRight className="janus-caret" />
          <span>Transcript</span>
          <span className="janus-transcript-word-count">
            not available yet
          </span>
        </div>
      </div>
    );
  }

  const words = wordCount(transcript);

  // Stable left/right alignment per speaker label. First speaker we encounter
  // sits on the left; second on the right; any further speakers wrap around.
  const speakerOrder: string[] = [];
  for (const t of turns) {
    if (!speakerOrder.includes(t.speaker)) speakerOrder.push(t.speaker);
  }
  const sideFor = (speaker: string) =>
    speakerOrder.indexOf(speaker) % 2 === 0 ? "left" : "right";

  return (
    <div className="janus-transcript-card">
      <button
        type="button"
        className={`janus-transcript-toggle ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight className="janus-caret" />
        <span>Transcript</span>
        <span className="janus-transcript-word-count">
          {words.toLocaleString()} words
          {turns.length ? ` · ${turns.length} turns` : ""}
        </span>
      </button>
      {open ? (
        <div className="janus-transcript-body">
          {turns.length > 0 ? (
            turns.map((t, i) => (
              <div key={i} className={`janus-turn ${sideFor(t.speaker)}`}>
                <div className="janus-turn-speaker">Speaker {t.speaker}</div>
                <div className="janus-turn-bubble">{t.text}</div>
              </div>
            ))
          ) : (
            <div className="janus-transcript-line">{transcript}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
