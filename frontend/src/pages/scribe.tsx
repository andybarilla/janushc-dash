import { useEffect, useMemo, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { ClipboardList, Mic } from "lucide-react";
import {
  useAddFeedback,
  useApproveSection,
  useDeleteScribeSession,
  useEditSection,
  useRejectSession,
  useRevokeSection,
  useSendToEHR,
  useScribeSession,
  useScribeSessions,
  useSessionFeedback,
} from "@/lib/scribe-queries";
import { useAuth } from "@/lib/auth";
import { useIsMobile } from "@/lib/use-is-mobile";
import { MobileScribe } from "@/components/scribe-mobile/mobile-scribe";
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
  const isMobile = useIsMobile();
  if (isMobile) return <MobileScribe />;
  return <DesktopScribe />;
}

function DesktopScribe() {
  const { data: sessions = [], isLoading: sessionsLoading } = useScribeSessions();
  const { user } = useAuth();
  const canApprove = user?.role === "physician";
  const navigate = useNavigate();

  const approveMut = useApproveSection();
  const revokeMut = useRevokeSection();
  const sendMut = useSendToEHR();
  const rejectMut = useRejectSession();
  const deleteMut = useDeleteScribeSession();
  const editMut = useEditSection();
  const addFeedbackMut = useAddFeedback();

  const sessionMatch = useMatch("/scribe/sessions/:sessionId");
  const selectedId = sessionMatch?.params.sessionId ?? null;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const [dateRange, setDateRange] = useState("today");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDefaultSection, setNotesDefaultSection] = useState<SectionKey | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadSource, setUploadSource] = useState<"record" | "paste">("record");

  // Auto-select the first session when the list loads and nothing is in the URL.
  useEffect(() => {
    if (selectedId) return;
    const first = sessions[0];
    if (first) {
      navigate(`/scribe/sessions/${first.id}`, { replace: true });
    }
  }, [sessions, selectedId, navigate]);

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
  const { data: notes = [] } = useSessionFeedback(selectedId ?? "");

  const handleSelect = (id: string) => {
    navigate(`/scribe/sessions/${id}`);
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

  const handleDelete = () => {
    if (!selectedId) return;
    if (
      !window.confirm(
        "Delete this encounter and all related notes, approvals, feedback, and audio? This can't be undone.",
      )
    )
      return;
    deleteMut.mutate(
      { sessionId: selectedId },
      {
        onSuccess: () => {
          const next = sessions.find((s) => s.id !== selectedId);
          navigate(next ? `/scribe/sessions/${next.id}` : "/scribe", { replace: true });
        },
      },
    );
  };

  const handleAddNote = (
    note: Omit<FeedbackNote, "id" | "at" | "author" | "authorInitials">,
  ) => {
    if (!selectedId) return;
    addFeedbackMut.mutate({
      sessionId: selectedId,
      section: note.section,
      category: note.category,
      body: note.body,
    });
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
            onClick={() => { setUploadSource("record"); setUploadOpen(true); }}
          >
            <Mic />
            Record
          </button>
          <button
            type="button"
            className="janus-btn janus-btn-secondary janus-btn-sm"
            onClick={() => { setUploadSource("paste"); setUploadOpen(true); }}
          >
            <ClipboardList />
            Paste transcript
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
          onDelete={handleDelete}
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
        onCreated={(id) => navigate(`/scribe/sessions/${id}`)}
        initialSource={uploadSource}
      />

      {sessionsLoading && sessions.length === 0 ? null : null}
    </div>
  );
}
