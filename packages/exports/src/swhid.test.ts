import { describe, expect, it } from "vitest";
import { swhidArchiveUrl, swhidForDirectory, swhidForRevision } from "./swhid.js";

describe("swhid derivation", () => {
  it("derives revision and directory SWHIDs from 40-hex Git ids", () => {
    expect(swhidForRevision("a".repeat(40))).toBe(`swh:1:rev:${"a".repeat(40)}`);
    expect(swhidForDirectory("b".repeat(40))).toBe(`swh:1:dir:${"b".repeat(40)}`);
  });

  it("returns undefined for SHA-256 object ids and malformed input", () => {
    expect(swhidForRevision("c".repeat(64))).toBeUndefined();
    expect(swhidForRevision("not-a-sha")).toBeUndefined();
    expect(swhidForDirectory("A".repeat(40))).toBeUndefined();
  });

  it("builds archive resolver URLs", () => {
    expect(swhidArchiveUrl(`swh:1:rev:${"a".repeat(40)}`)).toBe(
      `https://archive.softwareheritage.org/swh:1:rev:${"a".repeat(40)}/`,
    );
  });
});
