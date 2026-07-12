// Tiny IndexedDB-backed blob store for user-uploaded files (chord-sheet PDFs, mp3s).
// Kept out of localStorage/useLocalStore, which is JSON-only and size-limited.
// Song records store only a lightweight { fileId, name, mime, size } reference; the
// bytes live here, keyed by that id.

const DB_NAME = 'reps-files';
const STORE = 'files';
const DB_VERSION = 1;

export type StoredFile = {
  id: string;
  blob: Blob;
  mime: string;
  name: string;
  size: number;
  addedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  }));
}

function genId(): string {
  return 'f-' + Date.now().toString(36) + '-' + Math.floor(performance.now() * 1000).toString(36);
}

/** Store a blob; returns its generated id. */
export async function putFile(blob: Blob, meta: { name: string; mime?: string }): Promise<string> {
  const id = genId();
  const rec: StoredFile = {
    id, blob, name: meta.name,
    mime: meta.mime || blob.type || 'application/octet-stream',
    size: blob.size, addedAt: Date.now(),
  };
  await tx('readwrite', s => s.put(rec));
  return id;
}

export async function getFile(id: string): Promise<StoredFile | null> {
  const rec = await tx<StoredFile | undefined>('readonly', s => s.get(id));
  return rec ?? null;
}

export async function deleteFile(id: string): Promise<void> {
  await tx('readwrite', s => s.delete(id));
}

/** Object URL for playback/viewing. Caller must URL.revokeObjectURL when done. */
export async function objectUrl(id: string): Promise<string | null> {
  const rec = await getFile(id);
  return rec ? URL.createObjectURL(rec.blob) : null;
}

/** Count of stored files — used by tests / cleanup checks. */
export async function fileCount(): Promise<number> {
  return tx<number>('readonly', s => s.count());
}
