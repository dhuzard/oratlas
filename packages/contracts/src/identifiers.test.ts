import { describe, expect, it } from "vitest";
import { commitShaSchema } from "./identifiers.js";

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
