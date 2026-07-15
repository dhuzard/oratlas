import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateAtlasRepository } from "./evaluate.js";
import { renderAtlasCheckReport } from "./render.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Atlas Check evaluator", () => {
  it("accepts a complete deterministic TRUST/FAIR evidence graph", async () => {
    const root = await validRepository();
    const first = await evaluateAtlasRepository({ root });
    const second = await evaluateAtlasRepository({ root });

    expect(first).toEqual(second);
    expect(first.summary).toMatchObject({
      passed: true,
      errors: 0,
      warnings: 0,
      notices: 0,
      filesChecked: 8,
      recordsChecked: 4,
    });
    expect(renderAtlasCheckReport(first, "json")).toBe(renderAtlasCheckReport(second, "json"));
    expect(renderAtlasCheckReport(first, "json")).not.toContain(root);
  });

  it("reports invalid JSONL, broken references, missing anchors, and incomplete TRUST", async () => {
    const root = await validRepository();
    await writeFile(
      join(root, "knowledge", "claims.jsonl"),
      `${JSON.stringify({ id: "claim-1", text: "A claim without an anchor." })}\nnot-json\n`,
    );
    await writeFile(
      join(root, "knowledge", "relations.jsonl"),
      `${JSON.stringify({ claimId: "missing", citationId: "citation-1", relationType: "supports" })}\n`,
    );
    await writeFile(
      join(root, "knowledge", "trust.jsonl"),
      `${JSON.stringify({
        claimId: "claim-1",
        citationId: "citation-1",
        protocolVersion: "trust-poc-1.0",
        assessorType: "agent",
        criteria: { entailment: { rating: "not-assessed" } },
      })}\n`,
    );

    const report = await evaluateAtlasRepository({ root });
    const rules = report.findings.map((finding) => finding.ruleId);
    expect(report.summary.passed).toBe(false);
    expect(rules).toContain("ORATLAS-ARTIFACT-002");
    expect(rules).toContain("ORATLAS-RELATION-001");
    expect(rules).toContain("ORATLAS-CLAIM-001");
    expect(rules).toContain("ORATLAS-TRUST-002");
    expect(rules).toContain("ORATLAS-TRUST-003");
    expect(rules).toContain("ORATLAS-TRUST-004");
    expect(
      report.findings.find((finding) => finding.ruleId === "ORATLAS-ARTIFACT-002"),
    ).toMatchObject({ path: "knowledge/claims.jsonl", line: 2, severity: "error" });
  });

  it("fails closed for unsafe manifest paths and oversized documentation", async () => {
    const root = await validRepository();
    const manifest = JSON.parse(await readFixture(root, "review-manifest.json"));
    manifest.artifacts.claims = "../../outside.jsonl";
    await writeFile(join(root, "review-manifest.json"), JSON.stringify(manifest));
    await writeFile(join(root, "TRUST.md"), `# TRUST\n${"x".repeat(1024 * 1024 + 1)}`);

    const report = await evaluateAtlasRepository({ root });
    expect(report.summary.passed).toBe(false);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "ORATLAS-MANIFEST-003", severity: "error" }),
        expect.objectContaining({ ruleId: "ORATLAS-SECURITY-001", path: "TRUST.md" }),
      ]),
    );
  });

  it("never promotes a repository human-review assertion to Atlas verification", async () => {
    const root = await validRepository();
    const path = join(root, "knowledge", "trust.jsonl");
    const assessment = JSON.parse((await readFixture(root, "knowledge/trust.jsonl")).trim());
    assessment.reviewStatus = "human-reviewed";
    await writeFile(path, `${JSON.stringify(assessment)}\n`);

    const report = await evaluateAtlasRepository({ root });
    expect(report.summary.passed).toBe(true);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        ruleId: "ORATLAS-TRUST-005",
        severity: "notice",
        message: expect.stringContaining("unverified input"),
      }),
    );
  });

  it("escapes untrusted values in GitHub workflow annotations", async () => {
    const root = await validRepository();
    const attack = "claim\n::error file=pwned%line=1";
    const record = JSON.stringify({
      id: attack,
      text: "Duplicate malicious identifier",
      anchor: "x",
    });
    await writeFile(join(root, "knowledge", "claims.jsonl"), `${record}\n${record}\n`);
    const report = await evaluateAtlasRepository({ root });
    const output = renderAtlasCheckReport(report, "github");

    expect(output).toContain("ORATLAS-ARTIFACT-004");
    expect(output).toContain("%25");
    expect(output).not.toContain("\n::error file=pwned");
  });
});

async function validRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "oratlas-check-"));
  roots.push(root);
  await mkdir(join(root, "knowledge"), { recursive: true });
  const commit = "a".repeat(40);
  const manifest = {
    schemaVersion: "1.0.0",
    review: {
      title: "Evidence review",
      reviewType: "computational-literature-review",
      license: "CC-BY-4.0",
    },
    repository: { url: "https://github.com/example/review", commit },
    artifacts: {
      claims: "knowledge/claims.jsonl",
      citations: "knowledge/citations.jsonl",
      relations: "knowledge/relations.jsonl",
      trustAssessments: "knowledge/trust.jsonl",
      provenance: "provenance.json",
    },
  };
  await writeFile(join(root, "review-manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(root, "TRUST.md"), trustDocument());
  await writeFile(join(root, "FAIR.md"), fairDocument());
  await writeFile(join(root, "provenance.json"), JSON.stringify({ pipeline: "documented" }));
  await writeFile(
    join(root, "knowledge", "claims.jsonl"),
    `${JSON.stringify({ id: "claim-1", text: "A bounded, anchored evidence claim.", anchor: "results" })}\n`,
  );
  await writeFile(
    join(root, "knowledge", "citations.jsonl"),
    `${JSON.stringify({ id: "citation-1", doi: "10.5555/example.1", title: "Evidence" })}\n`,
  );
  await writeFile(
    join(root, "knowledge", "relations.jsonl"),
    `${JSON.stringify({ claimId: "claim-1", citationId: "citation-1", relationType: "supports" })}\n`,
  );
  const criteria = Object.fromEntries(
    [
      "identityIntegrity",
      "entailment",
      "sourceAccess",
      "populationRelevance",
      "interventionExposureRelevance",
      "outcomeRelevance",
      "methodologicalSafeguards",
      "statisticalSafeguards",
      "replicationConvergence",
      "conflictDependency",
    ].map((criterion) => [
      criterion,
      { rating: "moderate", status: "assessed", rationale: "Documented evidence review." },
    ]),
  );
  await writeFile(
    join(root, "knowledge", "trust.jsonl"),
    `${JSON.stringify({
      claimId: "claim-1",
      citationId: "citation-1",
      protocolVersion: "trust-poc-1.0",
      assessorType: "agent",
      criteria,
      reviewStatus: "agent-proposed",
    })}\n`,
  );
  return root;
}

function trustDocument(): string {
  return [
    "# TRUST assessment protocol",
    ...[
      "Identity Integrity",
      "Entailment",
      "Source Access",
      "Population Relevance",
      "Intervention Exposure Relevance",
      "Outcome Relevance",
      "Methodological Safeguards",
      "Statistical Safeguards",
      "Replication Convergence",
      "Conflict Dependency",
    ].flatMap((heading) => [
      `## ${heading}`,
      "The review records concrete evidence, limitations, and a remediation path for this criterion.",
    ]),
  ].join("\n\n");
}

function fairDocument(): string {
  return ["Findable", "Accessible", "Interoperable", "Reusable"]
    .flatMap((heading) => [
      `## ${heading}`,
      "The review documents a concrete repository practice, its limitation, and the planned improvement.",
    ])
    .join("\n\n");
}

async function readFixture(root: string, path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(join(root, path), "utf8");
}
