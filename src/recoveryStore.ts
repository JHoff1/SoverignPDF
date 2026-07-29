import type { Annotation } from "./editor/useDocumentEditor";

export type RecoverySnapshot = {
  id: string;
  fileName: string;
  sourcePath: string | null;
  bytes: ArrayBuffer;
  annotations: Annotation[];
  updatedAt: number;
};

type RecoveryJournal = {
  id: string;
  revisions: RecoverySnapshot[];
};

// Retain the pre-rebrand database name so recovery snapshots remain available.
const DATABASE = "sovereignpdf-local-recovery";
const STORE = "snapshots";
const MAX_REVISIONS = 5;

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>
) {
  const db = await database();
  try {
    return await operation(db.transaction(STORE, mode).objectStore(STORE));
  } finally {
    db.close();
  }
}

function revisionsFromRecord(
  record: RecoveryJournal | RecoverySnapshot | undefined
): RecoverySnapshot[] {
  if (!record) return [];
  if (
    "revisions" in record &&
    Array.isArray((record as RecoveryJournal).revisions)
  ) {
    return record.revisions;
  }
  return [record as RecoverySnapshot];
}

export function saveRecovery(snapshot: RecoverySnapshot) {
  return withStore("readwrite", async (store) => {
    const existing = await requestResult<
      RecoveryJournal | RecoverySnapshot | undefined
    >(store.get(snapshot.id));
    const revisions = [
      snapshot,
      ...revisionsFromRecord(existing).filter(
        (revision) => revision.updatedAt !== snapshot.updatedAt
      )
    ]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_REVISIONS);
    await requestResult(store.put({ id: snapshot.id, revisions }));
  });
}

export function readRecovery(id: string) {
  return withStore("readonly", async (store) => {
    const record = await requestResult<
      RecoveryJournal | RecoverySnapshot | undefined
    >(store.get(id));
    return revisionsFromRecord(record)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  });
}

export function listRecoverySnapshots() {
  return withStore("readonly", async (store) => {
    const records = await requestResult<
      Array<RecoveryJournal | RecoverySnapshot>
    >(store.getAll());
    return records
      .flatMap(revisionsFromRecord)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  });
}

export function deleteRecoveryRevision(id: string, updatedAt: number) {
  return withStore("readwrite", async (store) => {
    const record = await requestResult<
      RecoveryJournal | RecoverySnapshot | undefined
    >(store.get(id));
    const revisions = revisionsFromRecord(record).filter(
      (revision) => revision.updatedAt !== updatedAt
    );
    if (revisions.length) {
      await requestResult(store.put({ id, revisions }));
    } else {
      await requestResult(store.delete(id));
    }
  });
}

export function clearRecovery(id: string) {
  return withStore("readwrite", async (store) => {
    await requestResult(store.delete(id));
  });
}

export function clearAllRecoveries() {
  return withStore("readwrite", async (store) => {
    await requestResult(store.clear());
  });
}
