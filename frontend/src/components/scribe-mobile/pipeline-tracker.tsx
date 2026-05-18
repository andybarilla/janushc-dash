import {
  Check,
  CircleCheck,
  Inbox,
  Mic,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { StatusId } from "@/components/scribe/types";

interface Step {
  id: "queued" | "transcribing" | "extracting" | "ready";
  label: string;
  icon: LucideIcon;
}

const STEPS: Step[] = [
  { id: "queued", label: "Queued", icon: Inbox },
  { id: "transcribing", label: "Transcribing", icon: Mic },
  { id: "extracting", label: "Extracting", icon: Sparkles },
  { id: "ready", label: "Ready", icon: CircleCheck },
];

const ORDER: Record<StatusId, number> = {
  queued: 0,
  transcribing: 1,
  extracting: 2,
  ready: 3,
  sent: 3,
  failed: -1,
  rejected: -1,
};

export function MPipelineTracker({ statusId }: { statusId: StatusId }) {
  const activeIdx = ORDER[statusId];
  const fillPct = activeIdx >= 0 ? (activeIdx / (STEPS.length - 1)) * 100 : 0;

  return (
    <div className="m-pipeline">
      <div className="m-pipeline-lbl">Pipeline</div>
      <div className="m-pipeline-steps">
        <div className="m-pipeline-connector">
          <div className="fill" style={{ width: `${fillPct}%` }} />
        </div>
        {STEPS.map((step, i) => {
          const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "idle";
          const Icon = step.icon;
          return (
            <div key={step.id} className={`m-pipeline-step ${state}`}>
              <div className="dot">{state === "done" ? <Check /> : <Icon />}</div>
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
