import { describe, expect, it } from "vitest";
import { resolveE2EDatabaseUrl } from "./e2e-database-url";

describe("resolveE2EDatabaseUrl", () => {
  const fallback = "file:/workspace/packages/db/prisma/dev.db";

  it("prefers an explicit end-to-end database over the workflow database", () => {
    expect(
      resolveE2EDatabaseUrl(
        {
          E2E_DATABASE_URL: "file:/tmp/isolated-e2e.db",
          DATABASE_URL: "file:/workspace/packages/db/prisma/ci.db",
        },
        fallback,
      ),
    ).toBe("file:/tmp/isolated-e2e.db");
  });

  it("uses the workflow database when no end-to-end override is set", () => {
    expect(
      resolveE2EDatabaseUrl({ DATABASE_URL: "file:/workspace/packages/db/prisma/ci.db" }, fallback),
    ).toBe("file:/workspace/packages/db/prisma/ci.db");
  });

  it("uses the deterministic default when neither environment value is set", () => {
    expect(resolveE2EDatabaseUrl({}, fallback)).toBe(fallback);
  });
});
