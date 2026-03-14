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
          ? "border-amber-300 bg-amber-50"
          : "border-gray-200 bg-white"
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
              <span className="text-amber-600 text-sm font-medium">
                Needs Review
              </span>
            )}
            <span className="font-medium">{item.patient_name}</span>
          </div>
          <div className="text-sm text-gray-600 mt-1">
            {item.procedure_name}
            {item.dosage && ` — ${item.dosage}`}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {item.staff_name && `Staff: ${item.staff_name} | `}
            Date: {item.order_date}
          </div>
          {item.flagged && item.flag_reasons && (
            <div className="mt-2 text-sm text-amber-700">
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
