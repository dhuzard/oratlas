import { describe, expect, it } from "vitest";
import { commitShaSchema, isChecksumValidOrcid } from "./identifiers.js";

describe("commitShaSchema", () => {
  it.each(["a".repeat(40), "b".repeat(64)])("accepts a full Git object id", (oid) => {
    expect(commitShaSchema.safeParse(oid).success).toBe(true);
  });

  it.each(["a".repeat(39), "a".repeat(41), "a".repeat(63), "a".repeat(65), "A".repeat(40)])(
    "rejects abbreviated or malformed object ids",
    (oid) => {
      expect(commitShaSchema.safeParse(oid).success).toBe(false);
    },
  );
});

describe("public ORCID checksum utility", () => {
  it.each(["0000-0002-1825-0097", "0000-0000-0000-001X"])(
    "accepts valid numeric and X checksums",
    (value) => {
      expect(isChecksumValidOrcid(value)).toBe(true);
    },
  );
  it.each([
    "0000-0002-1825-0098",
    "0000-0000-0000-001x",
    "0000-0002-1825-0097\n",
    "0000-0002-1825-009",
    "https://orcid.org/0000-0002-1825-0097",
  ])("rejects invalid format or checksum", (value) => {
    expect(isChecksumValidOrcid(value)).toBe(false);
  });
});
