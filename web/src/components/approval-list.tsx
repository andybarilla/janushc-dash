"use client";

import { ApprovalCard, ApprovalItem } from "./approval-card";

interface ApprovalListProps {
  items: ApprovalItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

export function ApprovalList({ items, selectedIds, onToggle }: ApprovalListProps) {
  if (items.length === 0) {
    return (
      <div className="text-center text-gray-500 py-12">
        No pending approvals. You are all caught up.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ApprovalCard
          key={item.id}
          item={item}
          selected={selectedIds.has(item.id)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
