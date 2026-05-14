import { useEffect, useMemo, useState } from "react";
import { Download, Upload } from "lucide-react";
import {
  useScribeSession,
  useScribeSessions,
} from "@/lib/scribe-queries";
import {
  SessionList,
  buildEntries,
  type ListFilter,
} from "@/components/scribe/session-list";
import { DetailView } from "@/components/scribe/detail-view";
import { NotesDrawer } from "@/components/scribe/notes-drawer";
import { StatsStrip, type StatsValues } from "@/components/scribe/stats-strip";
import { UploadModal } from "@/components/scribe/upload-modal";
import { deriveStatusId, isInPipeline } from "@/components/scribe/status";
import type {
  Approvals,
  FeedbackNote,
  SectionKey,
} from "@/components/scribe/types";

const EMPTY_APPROVALS: Approvals = {
  hpi: false,
  plan: false,
  exam: false,
  labs: false,
};

// Per-session UI state (approvals + notes) lives client-side only.
// TODO: persist when backend endpoints exist.
type SessionUiState = {
  approvals: Approvals;
  notes: FeedbackNote[];
};

export default function ScribePage() {
  const { data: sessions = [], isLoading: sessionsLoading } = useScribeSessions();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [dateRange, setDateRange] = useState("today");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDefaultSection, setNotesDefaultSection] = useState<SectionKey | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uiBySession, setUiBySession] = useState<Record<string, SessionUiState>>({});

  // Auto-select the first session when the list loads.
  useEffect(() => {
    const first = sessions[0];
    if (!selectedId && first) {
      setSelectedId(first.id);
    }
  }, [sessions, selectedId]);

  // Poll the selected session more aggressively while it's in-flight.
  const { data: selectedDetail, isLoading: detailLoading } =
    useScribeSession(selectedId ?? "");

  const approvedCountFor = (id: string) =>
    (Object.keys(EMPTY_APPROVALS) as SectionKey[]).filter(
      (k) => uiBySession[id]?.approvals?.[k],
    ).length;

  const entries = useMemo(
    () => buildEntries(sessions, approvedCountFor),
    [sessions, uiBySession],
  );

  const stats: StatsValues = useMemo(() => {
    const today = new Date().toDateString();
    let todayTotal = 0;
    let inPipelineCount = 0;
    let awaitingReview = 0;
    let sentToEhr = 0;
    let needsAttention = 0;
    for (const e of entries) {
      if (new Date(e.session.created_at).toDateString() === today) todayTotal++;
      if (isInPipeline(e.statusId)) inPipelineCount++;
      if (e.statusId === "ready") awaitingReview++;
      if (e.statusId === "sent") sentToEhr++;
      if (e.statusId === "failed") needsAttention++;
    }
    return {
      todayTotal,
      inPipeline: inPipelineCount,
      awaitingReview,
      sentToEhr,
      needsAttention,
    };
  }, [entries]);

  const selectedUi = selectedId ? uiBySession[selectedId] : undefined;
  const approvals = selectedUi?.approvals ?? EMPTY_APPROVALS;
  const notes = selectedUi?.notes ?? [];

  const updateUi = (id: string, updater: (prev: SessionUiState) => SessionUiState) => {
    setUiBySession((prev) => ({
      ...prev,
      [id]: updater(prev[id] ?? { approvals: { ...EMPTY_APPROVALS }, notes: [] }),
    }));
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setNotesOpen(false);
    setNotesDefaultSection(null);
  };

  const handleApprove = (section: SectionKey) => {
    if (!selectedId) return;
    updateUi(selectedId, (prev) => ({
      ...prev,
      approvals: { ...prev.approvals, [section]: !prev.approvals[section] },
    }));
  };

  const handleApproveAll = () => {
    if (!selectedId) return;
    updateUi(selectedId, (prev) => ({
      ...prev,
      approvals: { hpi: true, plan: true, exam: true, labs: true },
    }));
  };

  const handleReject = () => {
    if (!selectedId) return;
    if (
      !window.confirm(
        'Reject this encounter? It will be flagged for re-processing.',
      )
    )
      return;
    updateUi(selectedId, (prev) => ({
      ...prev,
      approvals: { ...EMPTY_APPROVALS },
    }));
  };

  const handleAddNote = (
    note: Omit<FeedbackNote, "id" | "at" | "author" | "authorInitials">,
  ) => {
    if (!selectedId) return;
    const full: FeedbackNote = {
      id: `n_${Date.now()}`,
      author: "You",
      authorInitials: "YO",
      at: new Date().toISOString(),
      ...note,
    };
    updateUi(selectedId, (prev) => ({
      ...prev,
      notes: [...prev.notes, full],
    }));
  };

  const handleAddNoteForSection = (section: SectionKey) => {
    setNotesDefaultSection(section);
    setNotesOpen(true);
  };

  const statusId = selectedDetail
    ? deriveStatusId(
        selectedDetail,
        approvedCountFor(selectedDetail.id),
      )
    : null;

  return (
    <div className="janus-scribe-page">
      <div className="janus-page-header">
        <div>
          <h1>Scribe</h1>
          <p className="janus-page-subtitle">
            Review AI-extracted encounter notes before sending to the EHR.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="janus-btn janus-btn-secondary janus-btn-sm"
            disabled
            title="Coming soon"
          >
            <Download />
            Export today's batch
          </button>
          <button
            type="button"
            className="janus-btn janus-btn-secondary janus-btn-sm"
            onClick={() => setUploadOpen(true)}
          >
            <Upload />
            Upload audio
          </button>
        </div>
      </div>

      <StatsStrip stats={stats} />

      <div className="janus-workspace">
        <SessionList
          entries={entries}
          selectedId={selectedId}
          onSelect={handleSelect}
          query={query}
          onQuery={setQuery}
          filter={filter}
          onFilter={setFilter}
          dateRange={dateRange}
          onDateRange={setDateRange}
        />
        <DetailView
          session={selectedDetail ?? null}
          statusId={statusId}
          approvals={approvals}
          notes={notes}
          loading={!!selectedId && detailLoading && !selectedDetail}
          onApprove={handleApprove}
          onApproveAll={handleApproveAll}
          onReject={handleReject}
          onOpenNotes={() => {
            setNotesDefaultSection(null);
            setNotesOpen(true);
          }}
          onAddNoteForSection={handleAddNoteForSection}
          onRetry={() => {
            // Retry isn't wired to a backend endpoint yet.
            window.alert("Retry is not yet implemented.");
          }}
        />
        <NotesDrawer
          open={notesOpen}
          notes={notes}
          onClose={() => setNotesOpen(false)}
          onAddNote={handleAddNote}
          defaultSection={notesDefaultSection}
        />
      </div>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onCreated={(id) => setSelectedId(id)}
      />

      {sessionsLoading && sessions.length === 0 ? null : null}
    </div>
  );
}
