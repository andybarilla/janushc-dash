export const RECORDING_CHUNK_MS = 10_000;
export const RECORDING_DRAFT_DATABASE_NAME = "janus-recording-drafts";
export const RECORDING_DRAFT_DATABASE_VERSION = 1;
export const ACTIVE_RECORDING_DRAFT_ID = "active-mobile-recording";

export interface RecordingDraftMetadata {
  draftId: string;
  mimeType: string;
  fileExtension: string;
  patientId: string;
  departmentId: string;
  autoTranscribe: boolean;
  startedAt: string;
  updatedAt: string;
  elapsedSeconds: number;
  nextChunkIndex: number;
}

export interface RecordingDraftChunk {
  draftId: string;
  index: number;
  blob: Blob;
}

type RecordingDraftMetadataInput = Omit<
  RecordingDraftMetadata,
  "draftId" | "startedAt" | "updatedAt" | "nextChunkIndex"
>;

type RecordingDraftMetadataPatch = Pick<
  RecordingDraftMetadata,
  "elapsedSeconds" | "patientId" | "departmentId" | "autoTranscribe"
> & { nextChunkIndex?: number };

const METADATA_STORE_NAME = "metadata";
const CHUNKS_STORE_NAME = "chunks";
const DRAFT_ID_INDEX_NAME = "draftId";

function getIndexedDB(): IDBFactory | null {
  if (typeof window === "undefined" || !window.indexedDB) {
    return null;
  }

  return window.indexedDB;
}

function unavailableError(): Error {
  return new Error("IndexedDB is not available");
}

function openRecordingDraftDatabase(): Promise<IDBDatabase> {
  const indexedDB = getIndexedDB();
  if (!indexedDB) {
    return Promise.reject(unavailableError());
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(
      RECORDING_DRAFT_DATABASE_NAME,
      RECORDING_DRAFT_DATABASE_VERSION,
    );

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(METADATA_STORE_NAME)) {
        database.createObjectStore(METADATA_STORE_NAME, { keyPath: "draftId" });
      }
      if (!database.objectStoreNames.contains(CHUNKS_STORE_NAME)) {
        const chunksStore = database.createObjectStore(CHUNKS_STORE_NAME, {
          keyPath: ["draftId", "index"],
        });
        chunksStore.createIndex(DRAFT_ID_INDEX_NAME, DRAFT_ID_INDEX_NAME, { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

function completeTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function createActiveRecordingDraft(
  input: RecordingDraftMetadataInput,
): Promise<RecordingDraftMetadata> {
  const database = await openRecordingDraftDatabase();
  try {
    const now = new Date().toISOString();
    const metadata: RecordingDraftMetadata = {
      ...input,
      draftId: ACTIVE_RECORDING_DRAFT_ID,
      startedAt: now,
      updatedAt: now,
      nextChunkIndex: 0,
    };
    const transaction = database.transaction([METADATA_STORE_NAME, CHUNKS_STORE_NAME], "readwrite");
    transaction.objectStore(CHUNKS_STORE_NAME).index(DRAFT_ID_INDEX_NAME).openKeyCursor(
      IDBKeyRange.only(ACTIVE_RECORDING_DRAFT_ID),
    ).onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    transaction.objectStore(METADATA_STORE_NAME).put(metadata);
    await completeTransaction(transaction);
    return metadata;
  } finally {
    database.close();
  }
}

export async function getActiveRecordingDraft(): Promise<RecordingDraftMetadata | null> {
  if (!getIndexedDB()) {
    return null;
  }

  const database = await openRecordingDraftDatabase();
  try {
    const transaction = database.transaction(METADATA_STORE_NAME, "readonly");
    const result = await requestResult<RecordingDraftMetadata | undefined>(
      transaction.objectStore(METADATA_STORE_NAME).get(ACTIVE_RECORDING_DRAFT_ID),
    );
    return result ?? null;
  } finally {
    database.close();
  }
}

export async function saveRecordingDraftChunk(
  draftId: string,
  index: number,
  blob: Blob,
): Promise<void> {
  const database = await openRecordingDraftDatabase();
  try {
    const transaction = database.transaction(CHUNKS_STORE_NAME, "readwrite");
    transaction.objectStore(CHUNKS_STORE_NAME).put({ draftId, index, blob } satisfies RecordingDraftChunk);
    await completeTransaction(transaction);
  } finally {
    database.close();
  }
}

export async function updateActiveRecordingDraftMetadata(
  patch: RecordingDraftMetadataPatch,
): Promise<void> {
  const database = await openRecordingDraftDatabase();
  try {
    const transaction = database.transaction(METADATA_STORE_NAME, "readwrite");
    const store = transaction.objectStore(METADATA_STORE_NAME);
    const current = await requestResult<RecordingDraftMetadata | undefined>(
      store.get(ACTIVE_RECORDING_DRAFT_ID),
    );
    if (current) {
      store.put({ ...current, ...patch, updatedAt: new Date().toISOString() });
    }
    await completeTransaction(transaction);
  } finally {
    database.close();
  }
}

export async function buildRecordingDraftBlob(draftId: string, mimeType: string): Promise<Blob> {
  if (!getIndexedDB()) {
    return new Blob([], { type: mimeType });
  }

  const database = await openRecordingDraftDatabase();
  try {
    const transaction = database.transaction(CHUNKS_STORE_NAME, "readonly");
    const chunks = await requestResult<RecordingDraftChunk[]>(
      transaction.objectStore(CHUNKS_STORE_NAME).index(DRAFT_ID_INDEX_NAME).getAll(draftId),
    );
    const orderedBlobs = chunks.sort((left, right) => left.index - right.index).map((chunk) => chunk.blob);
    return new Blob(orderedBlobs, { type: mimeType });
  } finally {
    database.close();
  }
}

export async function deleteActiveRecordingDraft(): Promise<void> {
  const database = await openRecordingDraftDatabase();
  try {
    const transaction = database.transaction([METADATA_STORE_NAME, CHUNKS_STORE_NAME], "readwrite");
    transaction.objectStore(METADATA_STORE_NAME).delete(ACTIVE_RECORDING_DRAFT_ID);
    transaction.objectStore(CHUNKS_STORE_NAME).index(DRAFT_ID_INDEX_NAME).openKeyCursor(
      IDBKeyRange.only(ACTIVE_RECORDING_DRAFT_ID),
    ).onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    await completeTransaction(transaction);
  } finally {
    database.close();
  }
}
