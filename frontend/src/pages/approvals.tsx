import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useApprovals, useBatchApprove } from "@/lib/queries";
import { ApprovalCard } from "@/components/approval-card";
import { BatchActions } from "@/components/batch-actions";

export default function ApprovalsPage() {
  const { isAuthenticated, logout } = useAuth();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { data: items = [], isLoading, error } = useApprovals();
  const batchApprove = useBatchApprove();

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApprove = async () => {
    await batchApprove.mutateAsync(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const unflaggedItems = items.filter((i) => !i.flagged);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">emrai — Approvals</h1>
        <button
          onClick={logout}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Sign out
        </button>
      </header>

      <main className="max-w-3xl mx-auto py-6 px-4 space-y-4">
        {error && (
          <div className="bg-red-50 text-red-700 p-3 rounded text-sm">
            Failed to load approvals
          </div>
        )}

        {isLoading ? (
          <div className="text-center text-gray-500 py-12">Loading...</div>
        ) : items.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            No pending approvals. You are all caught up.
          </div>
        ) : (
          <>
            <BatchActions
              totalCount={items.length}
              selectedCount={selectedIds.size}
              unflaggedCount={unflaggedItems.length}
              onSelectAllUnflagged={() =>
                setSelectedIds(new Set(unflaggedItems.map((i) => i.id)))
              }
              onSelectAll={() =>
                setSelectedIds(new Set(items.map((i) => i.id)))
              }
              onDeselectAll={() => setSelectedIds(new Set())}
              onApprove={handleApprove}
              approving={batchApprove.isPending}
            />
            <div className="space-y-3">
              {items.map((item) => (
                <ApprovalCard
                  key={item.id}
                  item={item}
                  selected={selectedIds.has(item.id)}
                  onToggle={toggleItem}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
