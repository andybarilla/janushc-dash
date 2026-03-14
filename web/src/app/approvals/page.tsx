"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { ApprovalList } from "@/components/approval-list";
import { BatchActions } from "@/components/batch-actions";
import type { ApprovalItem } from "@/components/approval-card";

export default function ApprovalsPage() {
  const { isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login");
    }
  }, [isAuthenticated, router]);

  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.fetch<ApprovalItem[]>("/api/approvals");
      setItems(data);
    } catch {
      setError("Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) loadItems();
  }, [isAuthenticated, loadItems]);

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApprove = async () => {
    setApproving(true);
    setError("");
    try {
      await api.fetch("/api/approvals/batch-approve", {
        method: "POST",
        body: JSON.stringify({ item_ids: Array.from(selectedIds) }),
      });
      setSelectedIds(new Set());
      await loadItems();
    } catch {
      setError("Failed to approve orders");
    } finally {
      setApproving(false);
    }
  };

  const unflaggedItems = items.filter((i) => !i.flagged);

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">emrai — Approvals</h1>
        <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-700">
          Sign out
        </button>
      </header>

      <main className="max-w-3xl mx-auto py-6 px-4 space-y-4">
        {error && (
          <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{error}</div>
        )}

        {loading ? (
          <div className="text-center text-gray-500 py-12">Loading...</div>
        ) : (
          <>
            <BatchActions
              totalCount={items.length}
              selectedCount={selectedIds.size}
              unflaggedCount={unflaggedItems.length}
              onSelectAllUnflagged={() =>
                setSelectedIds(new Set(unflaggedItems.map((i) => i.id)))
              }
              onSelectAll={() => setSelectedIds(new Set(items.map((i) => i.id)))}
              onDeselectAll={() => setSelectedIds(new Set())}
              onApprove={handleApprove}
              approving={approving}
            />
            <ApprovalList
              items={items}
              selectedIds={selectedIds}
              onToggle={toggleItem}
            />
          </>
        )}
      </main>
    </div>
  );
}
