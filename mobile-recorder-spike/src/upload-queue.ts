export type PendingStatus = 'needs-session' | 'needs-upload' | 'done';

export type PendingItem = {
  id: string;
  fileUri: string;
  patientId: string;
  encounterId: string;
  departmentId: string;
  sessionId: string | null;
  status: PendingStatus;
};

export type ProcessDeps = {
  createSession: (item: PendingItem) => Promise<string>;
  uploadAudio: (sessionId: string, item: PendingItem) => Promise<void>;
};

// Advances one pending recording as far as it can. On failure it returns the
// item with the furthest-reached status (and any session id) so a later retry
// resumes at the right step instead of creating a duplicate session.
export async function processItem(item: PendingItem, deps: ProcessDeps): Promise<PendingItem> {
  let sessionId = item.sessionId;

  if (!sessionId) {
    try {
      sessionId = await deps.createSession(item);
    } catch {
      return { ...item, status: 'needs-session' };
    }
  }

  try {
    await deps.uploadAudio(sessionId, item);
  } catch {
    return { ...item, sessionId, status: 'needs-upload' };
  }

  return { ...item, sessionId, status: 'done' };
}
