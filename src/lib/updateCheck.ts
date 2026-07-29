export type UpdateCheckStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "unavailable";

type ParsedVersion = [number, number, number];

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(
    value.trim()
  );
  if (!match) return null;

  const parts = match.slice(1, 4).map(Number) as ParsedVersion;
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function normalizeReleaseVersion(value: unknown) {
  if (typeof value !== "string" || !parseVersion(value)) return null;
  const trimmed = value.trim();
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export function isReleaseNewer(releaseVersion: string, currentVersion: string) {
  const release = parseVersion(releaseVersion);
  const current = parseVersion(currentVersion);
  if (!release || !current) return false;

  for (let index = 0; index < release.length; index += 1) {
    if (release[index] !== current[index]) {
      return release[index] > current[index];
    }
  }
  return false;
}
