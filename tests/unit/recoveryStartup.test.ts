import { describe, expect, it } from "vitest";
import {
  isUsableRecoverySnapshot,
  migrateRecoverySnapshot,
  requestRecoveryWindow,
  recoveryStartupAction
} from "../../src/recoveryStartup";

describe("recoveryStartupAction", () => {
  it("keeps an explicitly requested PDF authoritative", () => {
    expect(recoveryStartupAction({
      hasSnapshot: true,
      requestedRecoveryWindow: false,
      explicitPdfPending: true,
      documentOpen: false
    })).toBe("defer-for-explicit-pdf");
  });

  it("restores only when a dedicated recovery window requested it", () => {
    expect(recoveryStartupAction({
      hasSnapshot: true,
      requestedRecoveryWindow: true,
      explicitPdfPending: false,
      documentOpen: false
    })).toBe("restore-requested-window");
  });

  it("uses the recovery prompt for an ordinary empty launch", () => {
    expect(recoveryStartupAction({
      hasSnapshot: true,
      requestedRecoveryWindow: false,
      explicitPdfPending: false,
      documentOpen: false
    })).toBe("prompt");
  });
});

describe("isUsableRecoverySnapshot", () => {
  it("rejects missing and corrupt recovery payloads", () => {
    expect(isUsableRecoverySnapshot(undefined)).toBe(false);
    expect(isUsableRecoverySnapshot({
      id: "main",
      fileName: "broken.pdf",
      sourcePath: null,
      bytes: "not document bytes",
      annotations: [],
      updatedAt: Date.now()
    })).toBe(false);
  });

  it("accepts a complete local recovery snapshot", () => {
    expect(isUsableRecoverySnapshot({
      id: "main",
      fileName: "recovered.pdf",
      sourcePath: "C:\\missing\\recovered.pdf",
      bytes: new Uint8Array([37, 80, 68, 70, 45]).buffer,
      annotations: [],
      updatedAt: Date.now()
    })).toBe(true);
  });
});

describe("recovery failure handling", () => {
  const snapshot = {
    id: "main",
    fileName: "recovered.pdf",
    sourcePath: null,
    bytes: new Uint8Array([37, 80, 68, 70, 45]).buffer,
    annotations: [],
    updatedAt: 1
  };

  it("keeps restoration available when old-journal cleanup fails", async () => {
    let savedId = "";
    const migrated = await migrateRecoverySnapshot({
      snapshot,
      targetId: "document-1",
      save: async (value) => {
        savedId = value.id;
      },
      clear: async () => {
        throw new Error("IndexedDB cleanup failed");
      }
    });
    expect(savedId).toBe("document-1");
    expect(migrated).toBe(false);
  });

  it("does not dismiss recovery when native window creation fails", async () => {
    const result = await requestRecoveryWindow("main", async () => {
      throw new Error("window creation failed");
    });
    expect(result.opened).toBe(false);
  });
});
