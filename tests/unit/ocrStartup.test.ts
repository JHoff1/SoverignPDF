import { describe, expect, it, vi } from "vitest";
import {
  awaitOcrStartup,
  friendlyOcrStatus,
  OcrStartupCanceledError,
  OcrStartupTimeoutError
} from "../../src/lib/ocrStartup";

describe("awaitOcrStartup", () => {
  it("times out and disposes a worker that resolves late", async () => {
    vi.useFakeTimers();
    const dispose = vi.fn();
    let resolveWorker: ((value: string) => void) | undefined;
    const result = awaitOcrStartup({
      start: () => new Promise<string>((resolve) => {
        resolveWorker = resolve;
      }),
      timeoutMs: 1_000,
      isCanceled: () => false,
      dispose
    });

    const assertion = expect(result).rejects.toBeInstanceOf(OcrStartupTimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    resolveWorker?.("late worker");
    await vi.runAllTimersAsync();
    expect(dispose).toHaveBeenCalledWith("late worker");
    vi.useRealTimers();
  });

  it("can be canceled while the worker is initializing", async () => {
    vi.useFakeTimers();
    let canceled = false;
    const result = awaitOcrStartup({
      start: () => new Promise<string>(() => undefined),
      timeoutMs: 10_000,
      isCanceled: () => canceled,
      dispose: vi.fn()
    });

    const assertion = expect(result).rejects.toBeInstanceOf(OcrStartupCanceledError);
    canceled = true;
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    vi.useRealTimers();
  });
});

describe("friendlyOcrStatus", () => {
  it("turns Tesseract implementation messages into user-facing status", () => {
    expect(friendlyOcrStatus("initializing tesseract")).toBe(
      "Initializing offline OCR engine…"
    );
    expect(friendlyOcrStatus("recognizing text")).toBe("Recognizing text…");
  });
});
