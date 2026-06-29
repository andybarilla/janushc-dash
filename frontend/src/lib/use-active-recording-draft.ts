import { useCallback, useEffect, useState } from "react";
import {
  listRecordingDrafts,
  type RecordingDraftMetadata,
} from "@/lib/recording-drafts";

export function useRecordingDrafts(currentUserId: string | null): {
  drafts: RecordingDraftMetadata[];
  loading: boolean;
  refresh: () => void;
} {
  const [drafts, setDrafts] = useState<RecordingDraftMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    if (!currentUserId) {
      setDrafts([]);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    void listRecordingDrafts(currentUserId)
      .then((result) => {
        if (active) setDrafts(result);
      })
      .catch(() => {
        if (active) setDrafts([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUserId, tick]);

  return { drafts, loading, refresh };
}

export function useActiveRecordingDraft(currentUserId: string | null): {
  draft: RecordingDraftMetadata | null;
  loading: boolean;
  refresh: () => void;
} {
  const { drafts, loading, refresh } = useRecordingDrafts(currentUserId);
  return { draft: drafts[0] ?? null, loading, refresh };
}
