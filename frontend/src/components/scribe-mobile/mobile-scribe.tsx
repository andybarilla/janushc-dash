import { useMemo, useRef, useState } from "react";
import { useLocation, useMatch, useNavigate, useSearchParams } from "react-router-dom";
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
import { MHomeView } from "./home-view";
import { MInboxView } from "./inbox-view";
import { MDetailView } from "./detail-view";
import { MFeedbackSheet } from "./feedback-sheet";
import { MRecordView } from "./record-view";
import type { MobileFilter } from "./filter-row";

const FILTER_VALUES: readonly MobileFilter[] = [
  "all",
  "ready",
  "in_pipeline",
  "sent",
  "attention",
];

function parseFilter(value: string | null): MobileFilter {
  return FILTER_VALUES.includes(value as MobileFilter)
    ? (value as MobileFilter)
    : "all";
}

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

  const navigate = useNavigate();
  const location = useLocation();
  const recordMatch = useMatch("/scribe/record");
  const inboxMatch = useMatch("/scribe/inbox");
  const detailMatch = useMatch("/scribe/sessions/:sessionId");
  const selectedId = detailMatch?.params.sessionId ?? null;

  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parseFilter(searchParams.get("filter"));
  const setFilter = (f: MobileFilter) => {
    const next = new URLSearchParams(searchParams);
    if (f === "all") next.delete("filter");
    else next.set("filter", f);
    setSearchParams(next, { replace: true });
  };

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTarget, setSheetTarget] = useState<NoteTarget | null>(null);
  const inboxScrollRef = useRef(0);

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

  // location.key === "default" means this is the first entry in history (deep link
  // or refresh). In that case, in-page "back" should jump to a sensible parent
  // instead of bouncing to login.
  const isFreshLanding = location.key === "default";
  const backTo = (fallback: string) => {
    if (isFreshLanding) navigate(fallback);
    else navigate(-1);
  };

  const providerName = user?.name?.trim() || "Provider";

  let view: "home" | "record" | "inbox" | "detail" = "home";
  if (detailMatch) view = "detail";
  else if (recordMatch) view = "record";
  else if (inboxMatch) view = "inbox";

  return (
    <div className="m-app m-overlay janus-scope">
      {view === "home" ? (
        isLoading && sessions.length === 0 ? (
          <LoadingInbox />
        ) : (
          <MHomeView
            sessions={sessions}
            providerName={providerName}
            onRecord={() => navigate("/scribe/record")}
            onOpenInbox={(f) => {
              const search = f === "all" ? "" : `?filter=${f}`;
              navigate(`/scribe/inbox${search}`);
            }}
            onOpenEncounter={(id) => navigate(`/scribe/sessions/${id}`)}
          />
        )
      ) : view === "record" ? (
        <MRecordView
          onBack={() => backTo("/scribe")}
          onSaved={() => navigate("/scribe")}
        />
      ) : view === "inbox" ? (
        isLoading && sessions.length === 0 ? (
          <LoadingInbox />
        ) : (
          <MInboxView
            sessions={sessions}
            selectedId={selectedId}
            filter={filter}
            onFilter={setFilter}
            scrollRef={inboxScrollRef}
            onBack={() => backTo("/scribe")}
            onSelect={(id) => navigate(`/scribe/sessions/${id}`)}
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
          onBack={() => backTo("/scribe/inbox")}
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
