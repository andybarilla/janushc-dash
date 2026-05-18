import { useState } from "react";
import { useScribeSessions } from "@/lib/scribe-queries";
import { MInboxView } from "./inbox-view";
import type { MobileFilter } from "./filter-row";
import { MDetailTopBar } from "./top-bar";

type View = "inbox" | "detail";

export function MobileScribe() {
  const { data: sessions = [], isLoading } = useScribeSessions();
  const [view, setView] = useState<View>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MobileFilter>("all");

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

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
        <DetailPlaceholder
          patientName={selected?.patient_id ?? "Encounter"}
          onBack={() => setView("inbox")}
        />
      )}
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

function DetailPlaceholder({
  patientName,
  onBack,
}: {
  patientName: string;
  onBack: () => void;
}) {
  return (
    <>
      <MDetailTopBar title={patientName} onBack={onBack} />
      <div
        className="m-body"
        style={{ padding: 24, color: "var(--janus-text-light)" }}
      >
        Detail view arrives in phase 4.
      </div>
    </>
  );
}
