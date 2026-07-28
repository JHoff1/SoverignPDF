export class OcrStartupTimeoutError extends Error {
  constructor() {
    super("The local OCR engine did not finish starting.");
    this.name = "OcrStartupTimeoutError";
  }
}

export class OcrStartupCanceledError extends Error {
  constructor() {
    super("OCR canceled.");
    this.name = "OcrStartupCanceledError";
  }
}

export async function awaitOcrStartup<T>({
  start,
  timeoutMs,
  isCanceled,
  dispose
}: {
  start: () => Promise<T>;
  timeoutMs: number;
  isCanceled: () => boolean;
  dispose: (value: T) => void | Promise<void>;
}): Promise<T> {
  let finished = false;
  let timeoutId: number | undefined;
  let cancelId: number | undefined;

  const pending = Promise.resolve().then(start);
  const guarded = new Promise<T>((resolve, reject) => {
    const finish = (callback: () => void) => {
      if (finished) return;
      finished = true;
      if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
      if (cancelId !== undefined) globalThis.clearInterval(cancelId);
      callback();
    };

    timeoutId = globalThis.setTimeout(
      () => finish(() => reject(new OcrStartupTimeoutError())),
      timeoutMs
    ) as unknown as number;
    cancelId = globalThis.setInterval(() => {
      if (isCanceled()) {
        finish(() => reject(new OcrStartupCanceledError()));
      }
    }, 100) as unknown as number;

    pending.then(
      (value) => {
        if (finished) {
          void dispose(value);
          return;
        }
        finish(() => resolve(value));
      },
      (cause) => finish(() => reject(cause))
    );
  });

  return guarded;
}

export function friendlyOcrStatus(status: string): string {
  const normalized = status.trim().toLowerCase();
  const labels: Record<string, string> = {
    "loading tesseract core": "Loading offline OCR engine…",
    "loaded tesseract core": "Offline OCR engine loaded…",
    "initializing tesseract": "Initializing offline OCR engine…",
    "initialized tesseract": "Offline OCR engine initialized…",
    "loading language traineddata": "Loading English OCR data…",
    "loaded language traineddata": "English OCR data loaded…",
    "initializing api": "Preparing offline text recognition…",
    "initialized api": "Offline text recognition ready…",
    "recognizing text": "Recognizing text…"
  };
  return labels[normalized] ?? status;
}
