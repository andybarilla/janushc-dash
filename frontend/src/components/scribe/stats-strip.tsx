import {
  CalendarDays,
  CheckCheck,
  CircleDot,
  Loader,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

export interface StatsValues {
  todayTotal: number;
  inPipeline: number;
  awaitingReview: number;
  sentToEhr: number;
  needsAttention: number;
}

interface CardDef {
  label: string;
  icon: LucideIcon;
  value: number;
  foot: string;
  tone?: "attention" | "alert";
}

function Sparkline({
  data,
  tone,
}: {
  data: number[];
  tone?: "attention" | "alert";
}) {
  if (data.length === 0) return null;
  const w = 100;
  const h = 24;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = w / (data.length - 1 || 1);
  const points = data.map(
    (v, i) =>
      [i * step, h - ((v - min) / range) * h * 0.85 - 2] as [number, number],
  );
  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const fillPath = `${path} L ${w} ${h} L 0 ${h} Z`;
  const stroke =
    tone === "attention"
      ? "var(--janus-warning-text)"
      : tone === "alert"
        ? "var(--janus-error-text)"
        : "var(--janus-primary)";
  return (
    <svg
      className="janus-stat-spark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <path className="janus-spark-fill" d={fillPath} />
      <path className="janus-spark-path" d={path} style={{ stroke }} />
    </svg>
  );
}

export function StatsStrip({ stats }: { stats: StatsValues }) {
  const cards: CardDef[] = [
    {
      label: "Today's volume",
      icon: CalendarDays,
      value: stats.todayTotal,
      foot:
        stats.todayTotal === 0 ? "no sessions yet today" : "sessions started today",
    },
    {
      label: "In pipeline",
      icon: Loader,
      value: stats.inPipeline,
      foot:
        stats.inPipeline === 0
          ? "queue is empty"
          : "transcribing & extracting",
    },
    {
      label: "Awaiting review",
      icon: CircleDot,
      value: stats.awaitingReview,
      tone: stats.awaitingReview > 0 ? "attention" : undefined,
      foot:
        stats.awaitingReview === 0
          ? "all caught up"
          : "ready to send to EHR",
    },
    {
      label: "Sent to EHR",
      icon: CheckCheck,
      value: stats.sentToEhr,
      foot: "approved & dispatched",
    },
    {
      label: "Needs attention",
      icon: TriangleAlert,
      value: stats.needsAttention,
      tone: stats.needsAttention > 0 ? "alert" : undefined,
      foot:
        stats.needsAttention === 0
          ? "no failures"
          : `${stats.needsAttention} failed`,
    },
  ];

  // Sparklines need history; without a stats endpoint we render a flat
  // placeholder shape that scales with the value so the design isn't empty.
  const placeholderSpark = (v: number) => {
    if (v === 0) return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    return Array.from({ length: 10 }, (_, i) =>
      Math.max(0, v * 0.4 + Math.sin(i * 0.8) * (v * 0.3)),
    );
  };

  return (
    <div className="janus-stats-strip">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.label} className={`janus-stat-card ${c.tone ?? ""}`}>
            <div className="janus-stat-label">
              <Icon />
              <span>{c.label}</span>
            </div>
            <div className="janus-stat-value">{c.value}</div>
            <Sparkline data={placeholderSpark(c.value)} tone={c.tone} />
            <div className="janus-stat-foot">{c.foot}</div>
          </div>
        );
      })}
    </div>
  );
}
