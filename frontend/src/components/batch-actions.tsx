interface BatchActionsProps {
  totalCount: number;
  selectedCount: number;
  unflaggedCount: number;
  onSelectAllUnflagged: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onApprove: () => void;
  approving: boolean;
}

export function BatchActions({
  totalCount,
  selectedCount,
  unflaggedCount,
  onSelectAllUnflagged,
  onSelectAll,
  onDeselectAll,
  onApprove,
  approving,
}: BatchActionsProps) {
  return (
    <div className="flex items-center justify-between bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {selectedCount} of {totalCount} selected
        </span>
        <button
          onClick={onSelectAllUnflagged}
          className="text-sm text-primary hover:text-primary/80"
        >
          Select all standard ({unflaggedCount})
        </button>
        <button
          onClick={onSelectAll}
          className="text-sm text-primary hover:text-primary/80"
        >
          Select all
        </button>
        <button
          onClick={onDeselectAll}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      </div>
      <button
        onClick={onApprove}
        disabled={selectedCount === 0 || approving}
        className="bg-green-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
      >
        {approving ? "Approving..." : `Approve selected (${selectedCount})`}
      </button>
    </div>
  );
}
