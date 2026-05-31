import { normalizeBaseUrl } from './config';

export type Department = { id: string; name: string };

export type Encounter = {
  encounter_id: string;
  patient_id: string;
  patient_name: string;
  department_id: string;
  date: string;
};

export type Session = {
  id: string;
  patient_id: string;
  encounter_id: string;
  department_id: string;
  status: string;
};

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

type ApiOptions = {
  baseUrl: string;
  token: string | null;
  onUnauthorized: () => void;
};

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(opts: ApiOptions, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${normalizeBaseUrl(opts.baseUrl)}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...authHeaders(opts.token) },
  });
  if (res.status === 401) {
    opts.onUnauthorized();
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

// Exchanges a Google idToken for the app JWT. Not authenticated, so it bypasses
// the shared request() helper's token handling.
export async function googleLogin(baseUrl: string, idToken: string): Promise<string> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`login failed: HTTP ${res.status} ${text}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export function listDepartments(opts: ApiOptions): Promise<Department[]> {
  return request<Department[]>(opts, '/api/scribe/departments', { method: 'GET' });
}

export function listEncounters(opts: ApiOptions, departmentId: string): Promise<Encounter[]> {
  return request<Encounter[]>(
    opts,
    `/api/scribe/encounters?department_id=${encodeURIComponent(departmentId)}`,
    { method: 'GET' },
  );
}

export function createSession(
  opts: ApiOptions,
  body: { patient_id: string; encounter_id: string; department_id: string },
): Promise<Session> {
  return request<Session>(opts, '/api/scribe/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Uploads the recorded audio to an existing session. No auto-transcribe flag is
// sent, so the backend marks the session "recording" for the web review flow.
export async function uploadAudio(opts: ApiOptions, sessionId: string, fileUri: string): Promise<void> {
  const form = new FormData();
  form.append('audio', {
    uri: fileUri,
    name: `janushc-${sessionId}.m4a`,
    type: 'audio/m4a',
  } as unknown as Blob);

  const res = await fetch(
    `${normalizeBaseUrl(opts.baseUrl)}/api/scribe/sessions/${sessionId}/upload`,
    { method: 'POST', headers: authHeaders(opts.token), body: form },
  );
  if (res.status === 401) {
    opts.onUnauthorized();
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`upload failed: HTTP ${res.status} ${text}`);
  }
}
