import { useState } from "react";

type View = "inbox" | "detail";

export function MobileScribe() {
  const [view, setView] = useState<View>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="m-app m-overlay janus-scope">
      {view === "inbox" ? (
        <Placeholder
          title="Inbox"
          subtitle="Mobile Scribe — phase 2 shell"
          actionLabel="Open a placeholder detail"
          onAction={() => {
            setSelectedId("placeholder");
            setView("detail");
          }}
        />
      ) : (
        <Placeholder
          title={`Detail (${selectedId})`}
          subtitle="Back returns to the inbox"
          actionLabel="← Back to inbox"
          onAction={() => setView("inbox")}
        />
      )}
    </div>
  );
}

function Placeholder({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "60px 16px 40px",
        gap: 12,
      }}
    >
      <h2 style={{ margin: 0, color: "var(--janus-primary)" }}>{title}</h2>
      <p style={{ margin: 0, color: "var(--janus-text-light)" }}>{subtitle}</p>
      <button
        type="button"
        onClick={onAction}
        style={{
          marginTop: 16,
          padding: "10px 16px",
          background: "var(--janus-primary)",
          color: "var(--janus-white)",
          border: "none",
          borderRadius: "var(--janus-radius-pill)",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          alignSelf: "flex-start",
        }}
      >
        {actionLabel}
      </button>
    </div>
  );
}
