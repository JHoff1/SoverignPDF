import type { RecoverySnapshot } from "./recoveryStore";

export type RecoveryStartupAction =
  | "none"
  | "restore-requested-window"
  | "defer-for-explicit-pdf"
  | "prompt";

export function recoveryStartupAction({
  hasSnapshot,
  requestedRecoveryWindow,
  explicitPdfPending,
  documentOpen
}: {
  hasSnapshot: boolean;
  requestedRecoveryWindow: boolean;
  explicitPdfPending: boolean;
  documentOpen: boolean;
}): RecoveryStartupAction {
  if (!hasSnapshot) return "none";
  if (requestedRecoveryWindow) return "restore-requested-window";
  if (documentOpen) return "none";
  if (explicitPdfPending) return "defer-for-explicit-pdf";
  return "prompt";
}

export function isUsableRecoverySnapshot(value: unknown): value is {
  id: string;
  fileName: string;
  sourcePath: string | null;
  bytes: ArrayBuffer;
  annotations: unknown[];
  updatedAt: number;
} {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return (
    typeof snapshot.id === "string" &&
    typeof snapshot.fileName === "string" &&
    (snapshot.sourcePath === null || typeof snapshot.sourcePath === "string") &&
    snapshot.bytes instanceof ArrayBuffer &&
    snapshot.bytes.byteLength > 4 &&
    Array.isArray(snapshot.annotations) &&
    typeof snapshot.updatedAt === "number" &&
    Number.isFinite(snapshot.updatedAt)
  );
}

export async function migrateRecoverySnapshot({
  snapshot,
  targetId,
  save,
  clear
}: {
  snapshot: RecoverySnapshot;
  targetId: string;
  save: (snapshot: RecoverySnapshot) => Promise<unknown>;
  clear: (id: string) => Promise<unknown>;
}): Promise<boolean> {
  try {
    await save({ ...snapshot, id: targetId });
    if (snapshot.id !== targetId) await clear(snapshot.id);
    return true;
  } catch {
    return false;
  }
}

export async function requestRecoveryWindow(
  recoveryId: string,
  create: (recoveryId: string) => Promise<string>
): Promise<{ opened: true; label: string } | { opened: false; cause: unknown }> {
  try {
    return { opened: true, label: await create(recoveryId) };
  } catch (cause) {
    return { opened: false, cause };
  }
}
