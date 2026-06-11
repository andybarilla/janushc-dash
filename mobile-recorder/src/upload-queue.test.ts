import { processItem, PendingItem } from './upload-queue';

function baseItem(): PendingItem {
  return {
    id: 'r1',
    fileUri: 'file:///tmp/r1.m4a',
    label: 'Jane D.',
    kind: 'audio',
    sessionId: null,
    status: 'needs-session',
  };
}

test('creates a session then uploads, reaching done', async () => {
  const calls: string[] = [];
  const result = await processItem(baseItem(), {
    createSession: async () => {
      calls.push('create');
      return 'sess-1';
    },
    upload: async (sessionId) => {
      calls.push(`upload:${sessionId}`);
    },
  });

  expect(calls).toEqual(['create', 'upload:sess-1']);
  expect(result.status).toBe('done');
  expect(result.sessionId).toBe('sess-1');
});

test('skips session creation when sessionId already exists', async () => {
  const calls: string[] = [];
  const item: PendingItem = { ...baseItem(), sessionId: 'sess-1', status: 'needs-upload' };

  const result = await processItem(item, {
    createSession: async () => {
      calls.push('create');
      return 'should-not-happen';
    },
    upload: async (sessionId) => {
      calls.push(`upload:${sessionId}`);
    },
  });

  expect(calls).toEqual(['upload:sess-1']);
  expect(result.status).toBe('done');
});

test('upload failure keeps the session id for a later resume', async () => {
  const result = await processItem(baseItem(), {
    createSession: async () => 'sess-1',
    upload: async () => {
      throw new Error('network down');
    },
  });

  expect(result.status).toBe('needs-upload');
  expect(result.sessionId).toBe('sess-1');
});

test('session creation failure stays at needs-session and skips upload', async () => {
  const calls: string[] = [];
  const result = await processItem(baseItem(), {
    createSession: async () => {
      calls.push('create');
      throw new Error('network down');
    },
    upload: async (sessionId) => {
      calls.push(`upload:${sessionId}`);
    },
  });
  expect(calls).toEqual(['create']);
  expect(result.status).toBe('needs-session');
  expect(result.sessionId).toBeNull();
});

test('a document item carries kind through to done', async () => {
  const item: PendingItem = { ...baseItem(), kind: 'document', fileUri: 'file:///tmp/scan.pdf' };
  const result = await processItem(item, {
    createSession: async () => 'sess-2',
    upload: async () => undefined,
  });
  expect(result.kind).toBe('document');
  expect(result.status).toBe('done');
});
