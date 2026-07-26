import type { Annotation } from "./editor/useDocumentEditor";

export type RecoverySnapshot = {
  id: string;
  fileName: string;
  sourcePath: string | null;
  bytes: ArrayBuffer;
  annotations: Annotation[];
  updatedAt: number;
};

const DATABASE = "sovereignpdf-local-recovery";
const STORE = "snapshots";

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

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
) {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = operation(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export function saveRecovery(snapshot: RecoverySnapshot) {
  return transact("readwrite", (store) => store.put(snapshot));
}

export function readRecovery(id: string) {
  return transact<RecoverySnapshot | undefined>("readonly", (store) => store.get(id));
}

export function clearRecovery(id: string) {
  return transact("readwrite", (store) => store.delete(id));
}
