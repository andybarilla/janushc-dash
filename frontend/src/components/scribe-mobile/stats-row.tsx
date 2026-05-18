import {
  CalendarDays,
  CheckCheck,
  CircleDot,
  Loader,
  TriangleAlert,
} from "lucide-react";

export interface MobileStats {
  today: number;
  ready: number;
  inPipeline: number;
  sent: number;
  attention: number;
}

export function MStatsRow({ stats }: { stats: MobileStats }) {
  return (
    <div className="m-stats-row">
      <Chip icon={<CalendarDays />} label="Today" value={stats.today} />
      <Chip icon={<CircleDot />} label="Ready" value={stats.ready} tone="attention" />
      <Chip icon={<Loader />} label="Pipeline" value={stats.inPipeline} />
      <Chip icon={<CheckCheck />} label="Sent" value={stats.sent} />
      <Chip icon={<TriangleAlert />} label="Attn" value={stats.attention} tone="alert" />
    </div>
  );
}

function Chip({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "attention" | "alert";
}) {
  return (
    <div className={`m-stat-chip${tone ? ` ${tone}` : ""}`}>
      <div className="lbl">
        {icon}
        {label}
      </div>
      <div className="val">{value}</div>
    </div>
  );
}
