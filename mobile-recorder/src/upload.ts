import { ApiOptions, createSession, uploadAudio, uploadDocument } from './api';
import { PendingItem, processItem } from './upload-queue';

// Drives one pending item through session-create + upload against the live API,
// resuming at whatever step it last failed on. The upload step dispatches by the
// item's kind. Never throws: processItem catches API errors and returns the item
// at its furthest-reached status.
export function runUpload(opts: ApiOptions, item: PendingItem): Promise<PendingItem> {
  return processItem(item, {
    createSession: async (it) => (await createSession(opts, { label: it.label })).id,
    upload: (sessionId, it) =>
      it.kind === 'document'
        ? uploadDocument(opts, sessionId, it.fileUri)
        : uploadAudio(opts, sessionId, it.fileUri),
  });
}
