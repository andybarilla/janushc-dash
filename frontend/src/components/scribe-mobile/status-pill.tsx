import type { StatusDef } from "@/components/scribe/types";

interface Props {
  status: StatusDef;
  large?: boolean;
}

export function MStatusPill({ status, large }: Props) {
  const Icon = status.icon;
  return (
    <span className={`m-status ${status.tone} ${large ? "lg" : ""}`}>
      <Icon />
      <span>{status.label}</span>
    </span>
  );
}
