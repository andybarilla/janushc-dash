import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Inbox } from "lucide-react";
import type { ScribeSession } from "@/lib/scribe-queries";
import { deriveStatusId, isInPipeline, wordCount } from "@/components/scribe/status";
import type { StatusId } from "@/components/scribe/types";
import { MInboxTopBar } from "./top-bar";
import { MFilterRow, type MobileFilter } from "./filter-row";
import { MSessionRow } from "./session-row";

interface Entry {
  session: ScribeSession;
  statusId: StatusId;
}

interface Props {
  sessions: ScribeSession[];
  selectedId: string | null;
  filter: MobileFilter;
  onFilter: (f: MobileFilter) => void;
  onSelect: (id: string) => void;
  onBack?: () => void;
  scrollRef?: MutableRefObject<number>;
}

function matches(statusId: StatusId, filter: MobileFilter): boolean {
  if (filter === "all") return statusId !== "rejected";
  if (filter === "ready") return statusId === "ready";
  if (filter === "in_pipeline") return isInPipeline(statusId);
  if (filter === "sent") return statusId === "sent";
  if (filter === "attention") return statusId === "failed" || statusId === "rejected";
  return true;
}

export function MInboxView({
  sessions,
  selectedId,
  filter,
  onFilter,
  onSelect,
  onBack,
  scrollRef,
}: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!scrollRef || !bodyRef.current) return;
    bodyRef.current.scrollTop = scrollRef.current;
  }, [scrollRef]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !scrollRef) return;
    const onScroll = () => {
      scrollRef.current = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  const entries: Entry[] = useMemo(
    () => sessions.map((s) => ({ session: s, statusId: deriveStatusId(s) })),
    [sessions],
  );

  const counts = useMemo<Record<MobileFilter, number>>(
    () => ({
      all: entries.filter((e) => matches(e.statusId, "all")).length,
      ready: entries.filter((e) => matches(e.statusId, "ready")).length,
      in_pipeline: entries.filter((e) => matches(e.statusId, "in_pipeline")).length,
      sent: entries.filter((e) => matches(e.statusId, "sent")).length,
      attention: entries.filter((e) => matches(e.statusId, "attention")).length,
    }),
    [entries],
  );

  const filtered = entries.filter((e) => matches(e.statusId, filter));
  const hasAlert = counts.attention > 0;

  return (
    <>
      <MInboxTopBar hasAlert={hasAlert} onBack={onBack} />
      <div className="m-body" ref={bodyRef}>
        <MFilterRow value={filter} onChange={onFilter} counts={counts} />
        <div className="m-list-meta">
          <span>
            {filtered.length} encounter{filtered.length === 1 ? "" : "s"}
          </span>
          <span>Newest first</span>
        </div>
        <div className="m-session-list">
          {filtered.length === 0 ? (
            <div className="m-empty">
              <Inbox />
              <div>No encounters match that filter.</div>
            </div>
          ) : (
            filtered.map((entry) => (
              <MSessionRow
                key={entry.session.id}
                session={entry.session}
                statusId={entry.statusId}
                wordCount={wordCount((entry.session as { transcript?: string }).transcript)}
                selected={selectedId === entry.session.id}
                onClick={() => onSelect(entry.session.id)}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
