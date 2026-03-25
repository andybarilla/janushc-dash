import { useState, useEffect } from "react";
import { useApprovals, useBatchApprove, useSync } from "@/lib/queries";
import { ApprovalCard } from "@/components/approval-card";
import { BatchActions } from "@/components/batch-actions";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export default function ApprovalsPage() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [syncMessage, setSyncMessage] = useState("");
  const [patientFilter, setPatientFilter] = useState("");
  const [procedureFilter, setProcedureFilter] = useState("");
  const { data: items = [], isLoading, error } = useApprovals();
  const batchApprove = useBatchApprove();
  const sync = useSync();

  useEffect(() => {
    setSelectedIds(new Set());
  }, [patientFilter, procedureFilter]);

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

  const filteredItems = items.filter((item) => {
    const matchesPatient =
      !patientFilter ||
      item.patient_name.toLowerCase().includes(patientFilter.toLowerCase());
    const matchesProcedure =
      !procedureFilter ||
      item.procedure_name.toLowerCase().includes(procedureFilter.toLowerCase());
    return matchesPatient && matchesProcedure;
  });

  const unflaggedItems = filteredItems.filter((i) => !i.flagged);

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
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Filter by patient name..."
              value={patientFilter}
              onChange={(e) => setPatientFilter(e.target.value)}
              className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              type="text"
              placeholder="Filter by procedure..."
              value={procedureFilter}
              onChange={(e) => setProcedureFilter(e.target.value)}
              className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <BatchActions
            totalCount={filteredItems.length}
            selectedCount={selectedIds.size}
            unflaggedCount={unflaggedItems.length}
            onSelectAllUnflagged={() => setSelectedIds(new Set(unflaggedItems.map((i) => i.id)))}
            onSelectAll={() => setSelectedIds(new Set(filteredItems.map((i) => i.id)))}
            onDeselectAll={() => setSelectedIds(new Set())}
            onApprove={handleApprove}
            approving={batchApprove.isPending}
          />
          {filteredItems.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 text-sm">
              No items match your filters.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => (
                <ApprovalCard key={item.id} item={item} selected={selectedIds.has(item.id)} onToggle={toggleItem} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
