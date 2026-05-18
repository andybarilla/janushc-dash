import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  useAddFeedback,
  useApproveSection,
  useRevokeSection,
  useScribeSession,
  useScribeSessions,
  useSendToEHR,
  useSessionFeedback,
} from "@/lib/scribe-queries";
import type {
  Approvals,
  NoteTarget,
  SectionKey,
} from "@/components/scribe/types";
import { deriveStatusId } from "@/components/scribe/status";
import { MInboxView } from "./inbox-view";
import { MDetailView } from "./detail-view";
import { MFeedbackSheet } from "./feedback-sheet";
import type { MobileFilter } from "./filter-row";

type View = "inbox" | "detail";

const EMPTY_APPROVALS: Approvals = {
  hpi: false,
  plan: false,
  exam: false,
  labs: false,
};

const SECTION_KEYS: SectionKey[] = ["hpi", "plan", "exam", "labs"];

export function MobileScribe() {
  const { user } = useAuth();
  const canApprove = user?.role === "physician";
  const { data: sessions = [], isLoading } = useScribeSessions();

  const [view, setView] = useState<View>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MobileFilter>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTarget, setSheetTarget] = useState<NoteTarget | null>(null);

  const { data: selectedDetail, isLoading: detailLoading } = useScribeSession(
    selectedId ?? "",
  );
  const { data: notes = [] } = useSessionFeedback(selectedId ?? "");

  const approveMut = useApproveSection();
  const revokeMut = useRevokeSection();
  const sendMut = useSendToEHR();
  const addFeedbackMut = useAddFeedback();

  const approvals: Approvals = useMemo(() => {
    const s = selectedDetail?.sections;
    if (!s) return EMPTY_APPROVALS;
    return {
      hpi: s.hpi?.state === "approved",
      plan: s.plan?.state === "approved",
      exam: s.exam?.state === "approved",
      labs: s.labs?.state === "approved",
    };
  }, [selectedDetail]);

  const statusId = selectedDetail ? deriveStatusId(selectedDetail) : null;

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

  const handleSend = () => {
    if (!selectedId || !canApprove) return;
    sendMut.mutate({ sessionId: selectedId });
  };

  return (
    <div className="m-app m-overlay janus-scope">
      {view === "inbox" ? (
        isLoading && sessions.length === 0 ? (
          <LoadingInbox />
        ) : (
          <MInboxView
            sessions={sessions}
            selectedId={selectedId}
            filter={filter}
            onFilter={setFilter}
            onSelect={(id) => {
              setSelectedId(id);
              setView("detail");
            }}
          />
        )
      ) : (
        <MDetailView
          session={selectedDetail ?? null}
          statusId={statusId}
          approvals={approvals}
          notes={notes}
          loading={!!selectedId && detailLoading && !selectedDetail}
          canApprove={canApprove}
          onBack={() => setView("inbox")}
          onApprove={handleApprove}
          onApproveAll={handleApproveAll}
          onSend={handleSend}
          onOpenNotes={() => {
            setSheetTarget(null);
            setSheetOpen(true);
          }}
          onAddNoteForSection={(section) => {
            setSheetTarget(section);
            setSheetOpen(true);
          }}
          onRetry={() => {
            window.alert("Retry is not yet implemented.");
          }}
        />
      )}
      <MFeedbackSheet
        open={sheetOpen}
        notes={notes}
        defaultSection={sheetTarget}
        onClose={() => setSheetOpen(false)}
        onSubmit={({ category, section, body }) => {
          if (!selectedId) return;
          addFeedbackMut.mutate({
            sessionId: selectedId,
            section,
            category,
            body,
          });
        }}
      />
    </div>
  );
}

function LoadingInbox() {
  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        color: "var(--janus-text-light)",
        fontSize: 13,
      }}
    >
      Loading…
    </div>
  );
}
