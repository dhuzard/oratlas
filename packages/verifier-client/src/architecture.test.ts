import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("external verifier client boundary", () => {
  it("contains no database, Prisma, or internal application imports", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/@prisma|@oratlas\/db|apps\/web|scientific-verification/);
    expect(source).toContain("fetcher");
  });
});
