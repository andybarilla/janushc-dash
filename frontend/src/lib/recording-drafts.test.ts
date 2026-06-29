import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_RECORDING_DRAFT_ID,
  buildRecordingDraftBlob,
  createActiveRecordingDraft,
  createRecordingDraft,
  deleteActiveRecordingDraft,
  deleteRecordingDraft,
  getActiveRecordingDraft,
  listRecordingDrafts,
  saveRecordingDraftChunk,
} from "./recording-drafts";

interface FakeStoredChunk {
  draftId: string;
  index: number;
  blob: Blob;
}

interface FakeStores {
  metadata: Map<string, unknown>;
  chunks: Map<string, FakeStoredChunk>;
}

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  succeed(result: T): void {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.({ target: this } as unknown as Event));
  }
}

class FakeCursor {
  constructor(
    private readonly keys: string[],
    private readonly store: Map<string, FakeStoredChunk>,
    private readonly request: FakeRequest<FakeCursor | null>,
    private position: number,
  ) {}

  delete(): void {
    const key = this.keys[this.position];
    if (key) {
      this.store.delete(key);
    }
  }

  continue(): void {
    this.position += 1;
    queueMicrotask(() => {
      this.request.result = this.position < this.keys.length ? this : null;
      this.request.onsuccess?.({ target: this.request } as unknown as Event);
    });
  }
}

class FakeObjectStore {
  constructor(
    private readonly name: "metadata" | "chunks",
    private readonly stores: FakeStores,
  ) {}

  createIndex(): void {}

  put(value: unknown): FakeRequest<IDBValidKey> {
    if (this.name === "metadata") {
      const metadata = value as { draftId: string };
      this.stores.metadata.set(metadata.draftId, value);
    } else {
      const chunk = value as FakeStoredChunk;
      this.stores.chunks.set(`${chunk.draftId}:${chunk.index}`, chunk);
    }
    const request = new FakeRequest<IDBValidKey>();
    request.succeed(1);
    return request;
  }

  get(key: string): FakeRequest<unknown> {
    const request = new FakeRequest<unknown>();
    request.succeed(this.stores.metadata.get(key));
    return request;
  }

  getAll(): FakeRequest<unknown[]> {
    const request = new FakeRequest<unknown[]>();
    request.succeed([...this.stores.metadata.values()]);
    return request;
  }

  delete(key: string): FakeRequest<undefined> {
    this.stores.metadata.delete(key);
    const request = new FakeRequest<undefined>();
    request.succeed(undefined);
    return request;
  }

  index(): FakeIndex {
    return new FakeIndex(this.stores);
  }
}

class FakeIndex {
  constructor(private readonly stores: FakeStores) {}

  getAll(draftId: string): FakeRequest<FakeStoredChunk[]> {
    const request = new FakeRequest<FakeStoredChunk[]>();
    request.succeed([...this.stores.chunks.values()].filter((chunk) => chunk.draftId === draftId));
    return request;
  }

  openKeyCursor(draftId: string): FakeRequest<FakeCursor | null> {
    const request = new FakeRequest<FakeCursor | null>();
    const keys = [...this.stores.chunks.entries()]
      .filter(([, chunk]) => chunk.draftId === draftId)
      .map(([key]) => key);
    request.succeed(keys.length > 0 ? new FakeCursor(keys, this.stores.chunks, request, 0) : null);
    return request;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: DOMException | null = null;

  constructor(private readonly stores: FakeStores) {
    setTimeout(() => this.oncomplete?.(), 0);
  }

  objectStore(name: "metadata" | "chunks"): FakeObjectStore {
    return new FakeObjectStore(name, this.stores);
  }
}

class FakeDatabase {
  objectStoreNames = { contains: () => false };

  constructor(private readonly stores: FakeStores) {}

  createObjectStore(name: "metadata" | "chunks"): FakeObjectStore {
    return new FakeObjectStore(name, this.stores);
  }

  transaction(storeName: string | string[]): FakeTransaction {
    void storeName;
    return new FakeTransaction(this.stores);
  }

  close(): void {}
}

class FakeIndexedDB {
  readonly stores: FakeStores = { metadata: new Map(), chunks: new Map() };

  open(): FakeRequest<FakeDatabase> & { onupgradeneeded: (() => void) | null } {
    const request = new FakeRequest<FakeDatabase>() as FakeRequest<FakeDatabase> & {
      onupgradeneeded: (() => void) | null;
    };
    request.onupgradeneeded = null;
    const database = new FakeDatabase(this.stores);
    request.result = database;
    queueMicrotask(() => {
      request.onupgradeneeded?.();
      request.succeed(database);
    });
    return request;
  }
}

function installFakeIndexedDB(): void {
  vi.stubGlobal("IDBKeyRange", { only: (value: string) => value });
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: new FakeIndexedDB(),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
});

describe("recording draft storage", () => {
  it("saves metadata and chunks out of order, then reconstructs an ordered Blob", async () => {
    installFakeIndexedDB();

    const metadata = await createActiveRecordingDraft({
      ownerUserId: "user-1",
      mimeType: "audio/webm",
      fileExtension: "webm",
      patientId: "patient-1",
      departmentId: "department-1",
      autoTranscribe: true,
      elapsedSeconds: 12,
    });
    await saveRecordingDraftChunk(metadata.draftId, 1, new Blob(["second"], { type: "audio/webm" }));
    await saveRecordingDraftChunk(metadata.draftId, 0, new Blob(["first"], { type: "audio/webm" }));

    await expect((await buildRecordingDraftBlob(metadata.draftId, "audio/webm")).text()).resolves.toBe(
      "firstsecond",
    );
    await expect(getActiveRecordingDraft()).resolves.toMatchObject({
      draftId: ACTIVE_RECORDING_DRAFT_ID,
      ownerUserId: "user-1",
      patientId: "patient-1",
    });
  });

  it("stores multiple recording drafts for the same user", async () => {
    installFakeIndexedDB();

    const first = await createRecordingDraft({
      ownerUserId: "user-1",
      mimeType: "audio/webm",
      fileExtension: "webm",
      patientId: "patient-1",
      departmentId: "department-1",
      autoTranscribe: true,
      elapsedSeconds: 12,
    });
    const second = await createRecordingDraft({
      ownerUserId: "user-1",
      mimeType: "audio/webm",
      fileExtension: "webm",
      patientId: "patient-2",
      departmentId: "department-1",
      autoTranscribe: false,
      elapsedSeconds: 20,
    });

    await expect(listRecordingDrafts("user-1")).resolves.toHaveLength(2);
    await deleteRecordingDraft(first.draftId);
    await expect(listRecordingDrafts("user-1")).resolves.toMatchObject([
      { draftId: second.draftId, patientId: "patient-2" },
    ]);
  });

  it("filters drafts by owner", async () => {
    installFakeIndexedDB();

    await createRecordingDraft({
      ownerUserId: "user-1",
      mimeType: "audio/webm",
      fileExtension: "webm",
      patientId: "patient-1",
      departmentId: "department-1",
      autoTranscribe: true,
      elapsedSeconds: 12,
    });
    await createRecordingDraft({
      ownerUserId: "user-2",
      mimeType: "audio/webm",
      fileExtension: "webm",
      patientId: "patient-2",
      departmentId: "department-1",
      autoTranscribe: true,
      elapsedSeconds: 12,
    });

    await expect(listRecordingDrafts("user-1")).resolves.toMatchObject([
      { ownerUserId: "user-1" },
    ]);
  });

  it("returns null when no active draft exists", async () => {
    installFakeIndexedDB();

    await expect(getActiveRecordingDraft()).resolves.toBeNull();
  });

  it("deletes active metadata and chunks", async () => {
    installFakeIndexedDB();
    const metadata = await createActiveRecordingDraft({
      ownerUserId: "user-1",
      mimeType: "audio/webm",
      fileExtension: "webm",
      patientId: "patient-1",
      departmentId: "department-1",
      autoTranscribe: false,
      elapsedSeconds: 0,
    });
    await saveRecordingDraftChunk(metadata.draftId, 0, new Blob(["audio"]));

    await deleteActiveRecordingDraft();

    await expect(getActiveRecordingDraft()).resolves.toBeNull();
    await expect((await buildRecordingDraftBlob(metadata.draftId, "audio/webm")).text()).resolves.toBe("");
  });

  it("handles unavailable IndexedDB", async () => {
    Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });

    await expect(getActiveRecordingDraft()).resolves.toBeNull();
    await expect((await buildRecordingDraftBlob(ACTIVE_RECORDING_DRAFT_ID, "audio/webm")).text()).resolves.toBe("");
    await expect(
      createActiveRecordingDraft({
        ownerUserId: "user-1",
        mimeType: "audio/webm",
        fileExtension: "webm",
        patientId: "patient-1",
        departmentId: "department-1",
        autoTranscribe: false,
        elapsedSeconds: 0,
      }),
    ).rejects.toThrow("IndexedDB is not available");
    await expect(saveRecordingDraftChunk(ACTIVE_RECORDING_DRAFT_ID, 0, new Blob())).rejects.toThrow(
      "IndexedDB is not available",
    );
    await expect(deleteActiveRecordingDraft()).rejects.toThrow("IndexedDB is not available");
  });
});
