import { describe, expect, it } from "vitest";
import {
  isReleaseNewer,
  normalizeReleaseVersion
} from "../../src/lib/updateCheck";

describe("update checks", () => {
  it("normalizes valid GitHub release tags", () => {
    expect(normalizeReleaseVersion("v0.1.14")).toBe("v0.1.14");
    expect(normalizeReleaseVersion("0.2.0")).toBe("v0.2.0");
    expect(normalizeReleaseVersion("not-a-version")).toBeNull();
    expect(normalizeReleaseVersion(null)).toBeNull();
  });

  it("compares semantic release versions", () => {
    expect(isReleaseNewer("v0.1.14", "0.1.13")).toBe(true);
    expect(isReleaseNewer("v0.2.0", "0.1.13")).toBe(true);
    expect(isReleaseNewer("v1.0.0", "0.99.99")).toBe(true);
    expect(isReleaseNewer("v0.1.13", "0.1.13")).toBe(false);
    expect(isReleaseNewer("v0.1.12", "0.1.13")).toBe(false);
  });
});
