import type { ApprovalItem } from "@/lib/queries";

interface ApprovalCardProps {
  item: ApprovalItem;
  selected: boolean;
  onToggle: (id: string) => void;
}

export function ApprovalCard({ item, selected, onToggle }: ApprovalCardProps) {
  return (
    <div
      className={`border rounded-lg p-4 ${
        item.flagged
          ? "border-amber-300 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/30"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(item.id)}
          className="mt-1"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {item.flagged && (
              <span className="text-amber-600 dark:text-amber-400 text-sm font-medium">
                Needs Review
              </span>
            )}
            <span className="font-medium">{item.patient_name}</span>
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {item.procedure_name}
            {item.dosage && ` — ${item.dosage}`}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {item.staff_name && `Staff: ${item.staff_name} | `}
            Date: {item.order_date}
          </div>
          {item.flagged && item.flag_reasons && (
            <div className="mt-2 text-sm text-amber-700 dark:text-amber-300">
              {item.flag_reasons.map((reason, i) => (
                <div key={i}>- {reason}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
