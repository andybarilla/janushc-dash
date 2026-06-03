import { pendingFor, upsertPending } from './pending';
import { PendingItem } from './upload-queue';

function item(overrides: Partial<PendingItem> = {}): PendingItem {
  return {
    id: 'rec-1',
    fileUri: 'file:///tmp/rec-1.m4a',
    label: 'Jane D.',
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
  const other = item({ id: 'rec-2' });
  const result = upsertPending([other], item({ status: 'needs-upload' }));
  expect(result).toContainEqual(other);
  expect(result).toHaveLength(2);
});

test('pendingFor builds a fresh needs-session item with no held attempt', () => {
  const result = pendingFor('Jane D.', 'file:///new.m4a');
  expect(result).toMatchObject({
    label: 'Jane D.',
    fileUri: 'file:///new.m4a',
    sessionId: null,
    status: 'needs-session',
  });
  expect(typeof result.id).toBe('string');
  expect(result.id.length).toBeGreaterThan(0);
});

test('pendingFor reuses a held session so a re-record does not duplicate it', () => {
  const held = item({ status: 'needs-upload', sessionId: 'sess-1' });
  const result = pendingFor('Jane D.', 'file:///rerecord.m4a', held);
  expect(result.sessionId).toBe('sess-1');
  expect(result.status).toBe('needs-upload');
  expect(result.fileUri).toBe('file:///rerecord.m4a');
  expect(result.id).toBe('rec-1');
});

test('pendingFor ignores a held attempt that never created a session', () => {
  const held = item({ status: 'needs-session', sessionId: null });
  const result = pendingFor('Jane D.', 'file:///rerecord.m4a', held);
  expect(result.sessionId).toBeNull();
  expect(result.status).toBe('needs-session');
});
