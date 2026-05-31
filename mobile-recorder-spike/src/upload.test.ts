import { createSession, uploadAudio } from './api';
import { runUpload } from './upload';
import { PendingItem } from './upload-queue';

// Factory mock so the real api module (and its AsyncStorage-backed config) is
// never loaded under jest.
jest.mock('./api', () => ({ createSession: jest.fn(), uploadAudio: jest.fn() }));

const createSessionMock = createSession as jest.MockedFunction<typeof createSession>;
const uploadAudioMock = uploadAudio as jest.MockedFunction<typeof uploadAudio>;

const opts = { baseUrl: 'http://x', token: 't', onUnauthorized: () => undefined };

function item(overrides: Partial<PendingItem> = {}): PendingItem {
  return {
    id: 'enc-1',
    fileUri: 'file:///enc-1.m4a',
    patientId: '55',
    encounterId: 'enc-1',
    departmentId: '1',
    sessionId: null,
    status: 'needs-session',
    ...overrides,
  };
}

beforeEach(() => {
  createSessionMock.mockReset();
  uploadAudioMock.mockReset();
});

test('creates a session from the encounter fields, then uploads the recorded file', async () => {
  createSessionMock.mockResolvedValue({
    id: 'sess-9',
    patient_id: '55',
    encounter_id: 'enc-1',
    department_id: '1',
    status: 'created',
  });
  uploadAudioMock.mockResolvedValue();

  const result = await runUpload(opts, item());

  expect(createSessionMock).toHaveBeenCalledWith(opts, {
    patient_id: '55',
    encounter_id: 'enc-1',
    department_id: '1',
  });
  expect(uploadAudioMock).toHaveBeenCalledWith(opts, 'sess-9', 'file:///enc-1.m4a');
  expect(result.status).toBe('done');
  expect(result.sessionId).toBe('sess-9');
});

test('reuses an existing session id without creating a duplicate', async () => {
  uploadAudioMock.mockResolvedValue();

  const result = await runUpload(opts, item({ sessionId: 'sess-1', status: 'needs-upload' }));

  expect(createSessionMock).not.toHaveBeenCalled();
  expect(uploadAudioMock).toHaveBeenCalledWith(opts, 'sess-1', 'file:///enc-1.m4a');
  expect(result.status).toBe('done');
});

test('keeps the session id when only the upload fails', async () => {
  createSessionMock.mockResolvedValue({
    id: 'sess-9',
    patient_id: '55',
    encounter_id: 'enc-1',
    department_id: '1',
    status: 'created',
  });
  uploadAudioMock.mockRejectedValue(new Error('network down'));

  const result = await runUpload(opts, item());

  expect(result.status).toBe('needs-upload');
  expect(result.sessionId).toBe('sess-9');
});
