import { Appointment } from './api';
import { PendingItem } from './upload-queue';

// Builds the pending item for a freshly recorded file. When an earlier attempt
// for the same appointment is still held with a session, the new recording
// reuses that session instead of creating a duplicate (and orphaning the first).
export function pendingFor(appointment: Appointment, fileUri: string, held?: PendingItem | null): PendingItem {
  return {
    id: appointment.appointment_id,
    fileUri,
    patientId: appointment.patient_id,
    appointmentId: appointment.appointment_id,
    departmentId: appointment.department_id,
    sessionId: held?.sessionId ?? null,
    status: held?.sessionId ? 'needs-upload' : 'needs-session',
  };
}

// Holds failed recordings in app memory so navigating away with "Later" no
// longer orphans them while the app runs. A completed item is removed; a
// still-pending item replaces any earlier entry for the same recording so a
// resume that advanced (needs-session → needs-upload) keeps its session id.
export function upsertPending(list: PendingItem[], item: PendingItem): PendingItem[] {
  const others = list.filter((p) => p.id !== item.id);
  return item.status === 'done' ? others : [...others, item];
}
