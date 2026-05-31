import { ApiOptions, createSession, uploadAudio } from './api';
import { PendingItem, processItem } from './upload-queue';

// Drives one pending recording through session-create + upload against the live
// API, resuming at whatever step it last failed on. Never throws: processItem
// catches API errors and returns the item at its furthest-reached status.
export function runUpload(opts: ApiOptions, item: PendingItem): Promise<PendingItem> {
  return processItem(item, {
    createSession: async (it) =>
      (
        await createSession(opts, {
          patient_id: it.patientId,
          encounter_id: it.encounterId,
          department_id: it.departmentId,
        })
      ).id,
    uploadAudio: (sessionId, it) => uploadAudio(opts, sessionId, it.fileUri),
  });
}
