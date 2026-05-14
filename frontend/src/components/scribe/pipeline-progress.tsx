import {
  Check,
  CircleCheck,
  Inbox,
  Mic,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { StatusDef, StatusId } from "./types";

const STEPS: { id: StatusId; label: string; icon: LucideIcon }[] = [
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

export function PipelineProgress({ status }: { status: StatusDef }) {
  const activeIdx = ORDER[status.id];
  const fillPct = (activeIdx / (STEPS.length - 1)) * 100;
  return (
    <div className="janus-pipeline-track">
      <div className="janus-pipeline-label">Pipeline</div>
      <div className="janus-pipeline-steps">
        <div className="janus-pipeline-connector">
          <div className="janus-fill" style={{ width: `${Math.max(0, fillPct)}%` }} />
        </div>
        {STEPS.map((s, i) => {
          const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "idle";
          const Icon = s.icon;
          return (
            <div key={s.id} className={`janus-pipeline-step ${state}`}>
              <div className="janus-dot">
                {state === "done" ? <Check /> : <Icon />}
              </div>
              <span>{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
