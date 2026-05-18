import type { ReactNode } from "react";
import { Bell, ChevronLeft, MoreHorizontal, Search } from "lucide-react";

interface BaseProps {
  right?: ReactNode;
}

export function MInboxTopBar({ right, hasAlert }: BaseProps & { hasAlert?: boolean }) {
  return (
    <div className="m-topbar">
      <div className="m-brand">
        <div className="m-brand-mark">J</div>
        <div className="m-brand-text">
          <span className="brand">Janus</span>
          <span className="module">Scribe</span>
        </div>
      </div>
      <div className="m-topbar-actions">
        {right ?? (
          <>
            <button type="button" className="m-icon-btn" aria-label="Search">
              <Search />
            </button>
            <button type="button" className="m-icon-btn" aria-label="Notifications">
              <Bell />
              {hasAlert ? <span className="badge-dot" /> : null}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface DetailTopBarProps {
  title: string;
  onBack: () => void;
  onMore?: () => void;
}

export function MDetailTopBar({ title, onBack, onMore }: DetailTopBarProps) {
  return (
    <div className="m-detail-topbar">
      <button type="button" className="m-back" onClick={onBack}>
        <ChevronLeft />
        <span>Inbox</span>
      </button>
      <div className="title" title={title}>
        {title}
      </div>
      <button
        type="button"
        className="m-icon-btn"
        aria-label="More actions"
        onClick={onMore}
      >
        <MoreHorizontal />
      </button>
    </div>
  );
}
