export function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createLocalId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function joinLocalPath(folder: string, name: string) {
  if (!folder) return name;
  const separator = folder.includes("\\") ? "\\" : "/";
  return `${folder.replace(/[\\/]+$/, "")}${separator}${name}`;
}

export function backupPath(path: string, now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return path.replace(/\.pdf$/i, `.backup-${timestamp}.pdf`);
}

export function parsePageRanges(value: string, pageCount: number) {
  const selected = new Set<number>();
  const parts = value.split(",").map((part) => part.trim());
  if (!parts.length || parts.some((part) => !part)) {
    return { pages: [], error: "Enter a page or range, such as 1-3,5." };
  }
  for (const part of parts) {
    const match = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) {
      return { pages: [], error: `"${part}" is not a valid page or range.` };
    }
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end > pageCount) {
      return { pages: [], error: `Pages must be between 1 and ${pageCount}.` };
    }
    if (start > end) {
      return { pages: [], error: `Range "${part}" must start with the lower page number.` };
    }
    for (let page = start; page <= end; page += 1) selected.add(page);
  }
  return { pages: [...selected].sort((a, b) => a - b), error: "" };
}

export function fileUrlToPath(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return value;
    const decoded = decodeURIComponent(url.pathname);
    if (url.hostname && url.hostname !== "localhost") {
      return `//${url.hostname}${decoded}`;
    }
    return /^\/[a-zA-Z]:\//.test(decoded) ? decoded.slice(1) : decoded;
  } catch {
    return value;
  }
}

export function normalizeLocalPath(value: string) {
  let path = fileUrlToPath(value).trim();
  if (/^\\\\\?\\UNC\\/i.test(path)) {
    path = `\\\\${path.slice(8)}`;
  } else if (/^\\\\\?\\/.test(path)) {
    path = path.slice(4);
  }
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\")) {
    path = path.replace(/\//g, "\\");
  }
  return path;
}

export function localPathKey(value: string) {
  const path = normalizeLocalPath(value);
  return /^[a-zA-Z]:\\/.test(path) || path.startsWith("\\\\")
    ? path.toLocaleLowerCase()
    : path;
}
