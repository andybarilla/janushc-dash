import type { StatusDef } from "./types";

interface Props {
  status: StatusDef;
  large?: boolean;
}

export function StatusPill({ status, large }: Props) {
  const Icon = status.icon;
  return (
    <span
      className={`janus-status ${status.tone} ${large ? "janus-status-lg" : ""}`}
    >
      <Icon />
      <span>{status.label}</span>
    </span>
  );
}
