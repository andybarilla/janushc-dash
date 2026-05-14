import { useEffect, useMemo, useState } from "react";
import { Download, Upload } from "lucide-react";
import {
  useApproveSection,
  useEditSection,
  useRejectSession,
  useRevokeSection,
  useSendToEHR,
  useScribeSession,
  useScribeSessions,
} from "@/lib/scribe-queries";
import { useAuth } from "@/lib/auth";
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
  SectionContent,
  SectionKey,
} from "@/components/scribe/types";

const EMPTY_APPROVALS: Approvals = {
  hpi: false,
  plan: false,
  exam: false,
  labs: false,
};

const SECTION_KEYS: SectionKey[] = ["hpi", "plan", "exam", "labs"];

export default function ScribePage() {
  const { data: sessions = [], isLoading: sessionsLoading } = useScribeSessions();
  const { user } = useAuth();
  const canApprove = user?.role === "physician";

  const approveMut = useApproveSection();
  const revokeMut = useRevokeSection();
  const sendMut = useSendToEHR();
  const rejectMut = useRejectSession();
  const editMut = useEditSection();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [dateRange, setDateRange] = useState("today");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDefaultSection, setNotesDefaultSection] = useState<SectionKey | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [notesBySession, setNotesBySession] = useState<Record<string, FeedbackNote[]>>({});

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

  const entries = useMemo(() => buildEntries(sessions), [sessions]);

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

  const approvals: Approvals = useMemo(() => {
    const sections = selectedDetail?.sections;
    if (!sections) return EMPTY_APPROVALS;
    return {
      hpi: sections.hpi?.state === "approved",
      plan: sections.plan?.state === "approved",
      exam: sections.exam?.state === "approved",
      labs: sections.labs?.state === "approved",
    };
  }, [selectedDetail]);
  const notes = (selectedId && notesBySession[selectedId]) || [];

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setNotesOpen(false);
    setNotesDefaultSection(null);
  };

  const handleApprove = (section: SectionKey) => {
    if (!selectedId || !canApprove) return;
    const mutation = approvals[section] ? revokeMut : approveMut;
    mutation.mutate({ sessionId: selectedId, section });
  };

  const handleApproveAll = () => {
    if (!selectedId || !canApprove) return;
    SECTION_KEYS.filter((k) => !approvals[k]).forEach((section) =>
      approveMut.mutate({ sessionId: selectedId, section }),
    );
  };

  const handleSaveSection = (section: SectionKey, content: SectionContent) => {
    if (!selectedId) return;
    editMut.mutate({ sessionId: selectedId, section, content });
  };

  const handleReject = () => {
    if (!selectedId || !canApprove) return;
    if (
      !window.confirm(
        "Reject this encounter? It won't be sent to the EHR. This can't be undone.",
      )
    )
      return;
    rejectMut.mutate({ sessionId: selectedId });
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
    setNotesBySession((prev) => ({
      ...prev,
      [selectedId]: [...(prev[selectedId] ?? []), full],
    }));
  };

  const handleAddNoteForSection = (section: SectionKey) => {
    setNotesDefaultSection(section);
    setNotesOpen(true);
  };

  const statusId = selectedDetail ? deriveStatusId(selectedDetail) : null;

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
          canApprove={canApprove}
          onApprove={handleApprove}
          onApproveAll={handleApproveAll}
          onReject={handleReject}
          onOpenNotes={() => {
            setNotesDefaultSection(null);
            setNotesOpen(true);
          }}
          onAddNoteForSection={handleAddNoteForSection}
          onSend={() => {
            if (selectedId) sendMut.mutate({ sessionId: selectedId });
          }}
          onSaveSection={handleSaveSection}
          onRetry={() => {
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
