import { useState } from "react";
import { useApprovals, useBatchApprove, useSync } from "@/lib/queries";
import { ApprovalCard } from "@/components/approval-card";
import { BatchActions } from "@/components/batch-actions";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export default function ApprovalsPage() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [syncMessage, setSyncMessage] = useState("");
  const { data: items = [], isLoading, error } = useApprovals();
  const batchApprove = useBatchApprove();
  const sync = useSync();

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

  const handleSync = () => {
    sync.mutate(undefined, {
      onSuccess: (data) => {
        setSyncMessage(`Synced ${data.synced_count} orders from Athena`);
        setTimeout(() => setSyncMessage(""), 3000);
      },
    });
  };

  const unflaggedItems = items.filter((i) => !i.flagged);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Pending Approvals</h2>
        <Button onClick={handleSync} disabled={sync.isPending} size="sm" variant="outline">
          <RefreshCw className={`mr-2 h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
          {sync.isPending ? "Syncing..." : "Sync from Athena"}
        </Button>
      </div>

      {syncMessage && (
        <div className="bg-green-500/10 text-green-500 p-3 rounded text-sm">{syncMessage}</div>
      )}

      {error && (
        <div className="bg-destructive/10 text-destructive p-3 rounded text-sm">
          Failed to load approvals
        </div>
      )}

      {isLoading ? (
        <div className="text-center text-muted-foreground py-12">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          No pending approvals. You are all caught up.
        </div>
      ) : (
        <>
          <BatchActions
            totalCount={items.length}
            selectedCount={selectedIds.size}
            unflaggedCount={unflaggedItems.length}
            onSelectAllUnflagged={() => setSelectedIds(new Set(unflaggedItems.map((i) => i.id)))}
            onSelectAll={() => setSelectedIds(new Set(items.map((i) => i.id)))}
            onDeselectAll={() => setSelectedIds(new Set())}
            onApprove={handleApprove}
            approving={batchApprove.isPending}
          />
          <div className="space-y-3">
            {items.map((item) => (
              <ApprovalCard key={item.id} item={item} selected={selectedIds.has(item.id)} onToggle={toggleItem} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
