import { useCallback, useEffect, useState } from "react";
import {
  getActiveRecordingDraft,
  type RecordingDraftMetadata,
} from "@/lib/recording-drafts";

export function useActiveRecordingDraft(currentUserId: string | null): {
  draft: RecordingDraftMetadata | null;
  loading: boolean;
  refresh: () => void;
} {
  const [draft, setDraft] = useState<RecordingDraftMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getActiveRecordingDraft()
      .then((result) => {
        if (!active) return;
        setDraft(result && result.ownerUserId === currentUserId ? result : null);
      })
      .catch(() => {
        if (active) setDraft(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUserId, tick]);

  return { draft, loading, refresh };
}
