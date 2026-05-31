import { Encounter } from './api';
import { pendingFor, upsertPending } from './pending';
import { PendingItem } from './upload-queue';

function item(overrides: Partial<PendingItem> = {}): PendingItem {
  return {
    id: 'enc-1',
    fileUri: 'file:///tmp/enc-1.m4a',
    patientId: '55',
    encounterId: 'enc-1',
    departmentId: '1',
    sessionId: null,
    status: 'needs-session',
    ...overrides,
  };
}

test('holds a still-pending recording', () => {
  expect(upsertPending([], item())).toEqual([item()]);
});

test('replaces the earlier entry for the same recording after a partial resume', () => {
  const before = [item({ status: 'needs-session', sessionId: null })];
  const advanced = item({ status: 'needs-upload', sessionId: 'sess-1' });
  expect(upsertPending(before, advanced)).toEqual([advanced]);
});

test('drops a recording once it reaches done', () => {
  const before = [item({ status: 'needs-upload', sessionId: 'sess-1' })];
  expect(upsertPending(before, item({ status: 'done', sessionId: 'sess-1' }))).toEqual([]);
});

test('leaves other recordings untouched', () => {
  const other = item({ id: 'enc-2', encounterId: 'enc-2' });
  const result = upsertPending([other], item({ status: 'needs-upload' }));
  expect(result).toContainEqual(other);
  expect(result).toHaveLength(2);
});

function encounter(): Encounter {
  return {
    encounter_id: 'enc-1',
    patient_id: '55',
    patient_name: 'Pat',
    department_id: '1',
    date: '05/31/2026',
    start_time: '09:00',
  };
}

test('pendingFor builds a fresh needs-session item with no held attempt', () => {
  const result = pendingFor(encounter(), 'file:///new.m4a');
  expect(result).toMatchObject({
    id: 'enc-1',
    encounterId: 'enc-1',
    patientId: '55',
    departmentId: '1',
    fileUri: 'file:///new.m4a',
    sessionId: null,
    status: 'needs-session',
  });
});

test('pendingFor reuses a held session so a re-record does not duplicate it', () => {
  const held = item({ status: 'needs-upload', sessionId: 'sess-1' });
  const result = pendingFor(encounter(), 'file:///rerecord.m4a', held);
  expect(result.sessionId).toBe('sess-1');
  expect(result.status).toBe('needs-upload');
  expect(result.fileUri).toBe('file:///rerecord.m4a');
});

test('pendingFor ignores a held attempt that never created a session', () => {
  const held = item({ status: 'needs-session', sessionId: null });
  const result = pendingFor(encounter(), 'file:///rerecord.m4a', held);
  expect(result.sessionId).toBeNull();
  expect(result.status).toBe('needs-session');
});
