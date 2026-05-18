import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { wordCount } from "@/components/scribe/status";

interface Props {
  transcript: string | undefined;
}

interface Turn {
  t: string;
  who: "Provider" | "Patient";
  text: string;
}

function parseTranscript(raw: string): Turn[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const m = line.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(Provider|Patient|Dr\.?|MD|Pt\.?)?[:\s-]*(.*)$/i);
    if (!m) return { t: "", who: "Provider", text: line };
    const t = m[1] ?? "";
    const whoRaw = (m[2] ?? "").toLowerCase();
    const who: Turn["who"] = whoRaw.startsWith("pt") || whoRaw === "patient" ? "Patient" : "Provider";
    return { t, who, text: m[3] ?? "" };
  });
}

export function MTranscriptCard({ transcript }: Props) {
  const [open, setOpen] = useState(false);
  if (!transcript) return null;
  const turns = parseTranscript(transcript);
  const words = wordCount(transcript);

  return (
    <div className="m-transcript">
      <button
        type="button"
        className={`m-transcript-toggle ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronRight className="caret" />
        <span>Transcript</span>
        <span className="wc">
          {words.toLocaleString()} w · {turns.length} turns
        </span>
      </button>
      {open ? (
        <div className="m-transcript-body">
          {turns.map((turn, i) => (
            <div key={i} className={`m-transcript-line ${turn.who.toLowerCase()}`}>
              <span className="t">{turn.t}</span>
              <span className="who">{turn.who}</span>
              <span>{turn.text}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
