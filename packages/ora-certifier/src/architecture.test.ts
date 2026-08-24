import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ORA certifier architecture", () => {
  it("uses the shared public API client and contains no database shortcut", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/ora-certifier/src/index.ts"),
      "utf8",
    );
    expect(source).toContain("CertifierApiClient");
    expect(source).toContain("client.createRun");
    expect(source).toContain("client.getInput");
    expect(source).toContain("client.submitResult");
    expect(source).toContain("client.transitionRun");
    expect(source).not.toMatch(
      /@prisma|PrismaClient|@oratlas\/db|\.certificationResult\.|submitCertificationResult\s*\(/,
    );
  });

  it("keeps the deterministic evaluator out of the production export", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/ora-certifier/src/index.ts"),
      "utf8",
    );
    expect(source).not.toContain("createDeterministicOraTestEvaluator");
  });
});
