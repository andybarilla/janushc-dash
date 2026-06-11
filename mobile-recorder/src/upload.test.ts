import { createSession, uploadAudio, uploadDocument } from './api';
import { runUpload } from './upload';
import { PendingItem } from './upload-queue';

jest.mock('./api', () => ({
  createSession: jest.fn(),
  uploadAudio: jest.fn(),
  uploadDocument: jest.fn(),
}));

const createSessionMock = createSession as jest.MockedFunction<typeof createSession>;
const uploadAudioMock = uploadAudio as jest.MockedFunction<typeof uploadAudio>;
const uploadDocumentMock = uploadDocument as jest.MockedFunction<typeof uploadDocument>;

const opts = { baseUrl: 'http://x', token: 't', onUnauthorized: () => undefined };

function item(overrides: Partial<PendingItem> = {}): PendingItem {
  return {
    id: 'rec-1',
    fileUri: 'file:///rec-1.m4a',
    label: 'Jane D.',
    kind: 'audio',
    sessionId: null,
    status: 'needs-session',
    ...overrides,
  };
}

beforeEach(() => {
  createSessionMock.mockReset();
  uploadAudioMock.mockReset();
  uploadDocumentMock.mockReset();
});

test('creates a session from the label, then uploads the recorded file', async () => {
  createSessionMock.mockResolvedValue({
    id: 'sess-9',
    patient_id: '',
    appointment_id: '',
    encounter_id: '',
    department_id: '',
    status: 'created',
  });
  uploadAudioMock.mockResolvedValue();

  const result = await runUpload(opts, item());

  expect(createSessionMock).toHaveBeenCalledWith(opts, { label: 'Jane D.' });
  expect(uploadAudioMock).toHaveBeenCalledWith(opts, 'sess-9', 'file:///rec-1.m4a');
  expect(result.status).toBe('done');
  expect(result.sessionId).toBe('sess-9');
});

test('reuses an existing session id without creating a duplicate', async () => {
  uploadAudioMock.mockResolvedValue();

  const result = await runUpload(opts, item({ sessionId: 'sess-1', status: 'needs-upload' }));

  expect(createSessionMock).not.toHaveBeenCalled();
  expect(uploadAudioMock).toHaveBeenCalledWith(opts, 'sess-1', 'file:///rec-1.m4a');
  expect(result.status).toBe('done');
});

test('keeps the session id when only the upload fails', async () => {
  createSessionMock.mockResolvedValue({
    id: 'sess-9',
    patient_id: '',
    appointment_id: '',
    encounter_id: '',
    department_id: '',
    status: 'created',
  });
  uploadAudioMock.mockRejectedValue(new Error('network down'));

  const result = await runUpload(opts, item());

  expect(result.status).toBe('needs-upload');
  expect(result.sessionId).toBe('sess-9');
});

test('uploads via uploadDocument for a document item', async () => {
  createSessionMock.mockResolvedValue({
    id: 'sess-9',
    patient_id: '',
    appointment_id: '',
    encounter_id: '',
    department_id: '',
    status: 'created',
  });
  uploadDocumentMock.mockResolvedValue();

  const result = await runUpload(opts, item({ kind: 'document', fileUri: 'file:///scan.pdf' }));

  expect(uploadDocumentMock).toHaveBeenCalledWith(opts, 'sess-9', 'file:///scan.pdf');
  expect(uploadAudioMock).not.toHaveBeenCalled();
  expect(result.status).toBe('done');
});
