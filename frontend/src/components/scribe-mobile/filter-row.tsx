import { Check, CircleDot, Loader, TriangleAlert, type LucideIcon } from "lucide-react";

export type MobileFilter = "all" | "ready" | "in_pipeline" | "sent" | "attention";

interface FilterDef {
  id: MobileFilter;
  label: string;
  icon?: LucideIcon;
}

const FILTERS: FilterDef[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready", icon: CircleDot },
  { id: "in_pipeline", label: "Pipeline", icon: Loader },
  { id: "sent", label: "Sent", icon: Check },
  { id: "attention", label: "Attn", icon: TriangleAlert },
];

interface Props {
  value: MobileFilter;
  onChange: (filter: MobileFilter) => void;
  counts: Record<MobileFilter, number>;
}

export function MFilterRow({ value, onChange, counts }: Props) {
  return (
    <div className="m-filter-row">
      {FILTERS.map((f) => {
        const Icon = f.icon;
        return (
          <button
            key={f.id}
            type="button"
            className={`m-chip ${value === f.id ? "active" : ""}`}
            onClick={() => onChange(f.id)}
          >
            {Icon ? <Icon /> : null}
            <span>{f.label}</span>
            <span className="chip-count">{counts[f.id]}</span>
          </button>
        );
      })}
    </div>
  );
}
