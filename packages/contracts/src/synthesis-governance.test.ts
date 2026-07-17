import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
  SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
  SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
  SYNTHESIS_PUBLIC_AI_LABEL,
  SYNTHESIS_PUBLIC_PRIVATE_FIELD_DENYLIST,
  SYNTHESIS_PUBLIC_CITATION_FIELDS,
  SYNTHESIS_PUBLIC_FRESHNESS_FIELDS,
  SYNTHESIS_PUBLIC_PROVENANCE_FIELDS,
  SYNTHESIS_PUBLIC_REVIEW_FIELDS,
  SYNTHESIS_PUBLIC_SCOPE_NOTICE,
  SYNTHESIS_PUBLIC_VERSION_FIELDS,
  SYNTHESIS_SUPPORTED_ACCEPTANCE_CHECKLIST_VERSIONS,
  SYNTHESIS_SUPPORTED_ATTRIBUTION_POLICY_VERSIONS,
  SYNTHESIS_SUPPORTED_MATERIALIZATION_POLICY_VERSIONS,
} from "./synthesis-editorial.js";

const root = resolve(import.meta.dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function markdownHeadingSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function expectLocalMarkdownLinksResolve(relativePath: string): void {
  const absolutePath = resolve(root, relativePath);
  const markdown = readFileSync(absolutePath, "utf8");
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const [target, fragment] = match[1]!.split("#", 2);
    if (/^(?:https?:|mailto:)/.test(target!)) continue;
    const targetPath = target ? resolve(dirname(absolutePath), target) : absolutePath;
    expect(existsSync(targetPath), `${relativePath}: ${target}`).toBe(true);
    if (fragment && targetPath.endsWith(".md")) {
      const headingSlugs = [
        ...readFileSync(targetPath, "utf8").matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm),
      ].map((heading) => markdownHeadingSlug(heading[1]!));
      expect(headingSlugs, `${relativePath}: #${fragment}`).toContain(decodeURIComponent(fragment));
    }
  }
}

describe("AI synthesis governance policy drift", () => {
  it("binds the normative policy to canonical versions and public wording", () => {
    const policy = read("docs/synthesis-governance.md");
    const normalizedPolicy = policy.replace(/\s+/g, " ");
    expect(policy).toContain("Policy identifier");
    expect(policy).toContain(`\`${SYNTHESIS_ATTRIBUTION_POLICY_VERSION}\``);
    expect(policy).toContain("Checklist identifier");
    expect(policy).toContain(`\`${SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION}\``);
    expect(policy).toContain("Materialization identifier");
    expect(policy).toContain(`\`${SYNTHESIS_MATERIALIZATION_POLICY_VERSION}\``);
    expect(policy).toContain(`**“${SYNTHESIS_PUBLIC_AI_LABEL}”**`);
    expect(normalizedPolicy).toContain(SYNTHESIS_PUBLIC_SCOPE_NOTICE);
    for (const heading of [
      "Authorship, credit, and accountability",
      "Public allowlist and private denylist",
      "Model, prompt, and exact evidence disclosure",
      "Rights and licensing",
      "DOI policy",
      "Editorial checklist and transitions",
      "Fail-closed integrity and privacy",
      "Corrections, withdrawals, and incidents",
      "Policy evolution and compatibility",
    ]) {
      expect(policy).toContain(heading);
    }
    expect(policy.match(/\bMUST(?: NOT)?\b/g)?.length ?? 0).toBeGreaterThan(35);
    expect(SYNTHESIS_PUBLIC_PRIVATE_FIELD_DENYLIST).toEqual(
      expect.arrayContaining([
        "agentRunId",
        "packetJson",
        "promptBytes",
        "providerResponse",
        "rawOutput",
        "editorialNotes",
        "apiKey",
      ]),
    );
    for (const privateConcept of [
      "AgentRun",
      "packet JSON/bytes",
      "prompt bytes",
      "provider request/response bytes",
      "raw or rejected output",
      "editorial rationale, notes",
      "API keys",
    ]) {
      expect(normalizedPolicy).toContain(privateConcept);
    }
  });

  it("keeps compatibility registries append-only and represented in OpenAPI", () => {
    const openapi = read("docs/openapi.yaml");
    expect(SYNTHESIS_SUPPORTED_ATTRIBUTION_POLICY_VERSIONS).toContain(
      SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
    );
    expect(SYNTHESIS_SUPPORTED_MATERIALIZATION_POLICY_VERSIONS).toContain(
      SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
    );
    expect(SYNTHESIS_SUPPORTED_ACCEPTANCE_CHECKLIST_VERSIONS).toContain(
      SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
    );
    for (const version of [
      ...SYNTHESIS_SUPPORTED_ATTRIBUTION_POLICY_VERSIONS,
      ...SYNTHESIS_SUPPORTED_MATERIALIZATION_POLICY_VERSIONS,
      ...SYNTHESIS_SUPPORTED_ACCEPTANCE_CHECKLIST_VERSIONS,
    ]) {
      expect(openapi).toContain(version);
    }
    expect(openapi).toContain("append-only compatibility registries");
    expect(SYNTHESIS_SUPPORTED_ATTRIBUTION_POLICY_VERSIONS).toContain(
      "synthesis-attribution/1.0.0",
    );
    expect(SYNTHESIS_SUPPORTED_MATERIALIZATION_POLICY_VERSIONS).toContain(
      "synthesis-materialization/1.0.0",
    );
    expect(SYNTHESIS_SUPPORTED_ACCEPTANCE_CHECKLIST_VERSIONS).toContain(
      "synthesis-checklist/1.0.0",
    );

    const schemas = (
      parseYaml(openapi) as {
        components: { schemas: Record<string, { properties: Record<string, unknown> }> };
      }
    ).components.schemas;
    expect(Object.keys(schemas.PublicSynthesisReview!.properties)).toEqual(
      SYNTHESIS_PUBLIC_REVIEW_FIELDS,
    );
    expect(Object.keys(schemas.AcceptedSynthesisProvenance!.properties)).toEqual(
      SYNTHESIS_PUBLIC_PROVENANCE_FIELDS,
    );
    expect(Object.keys(schemas.PublicSynthesisCitation!.properties)).toEqual(
      SYNTHESIS_PUBLIC_CITATION_FIELDS,
    );
    expect(Object.keys(schemas.PublicSynthesisVersion!.properties)).toEqual(
      SYNTHESIS_PUBLIC_VERSION_FIELDS,
    );
    expect(Object.keys(schemas.SynthesisFreshness!.properties)).toEqual(
      SYNTHESIS_PUBLIC_FRESHNESS_FIELDS,
    );
  });

  it("binds the shipped public UI to contract wording and resolves governance links", () => {
    const page = read("apps/web/src/app/reviews/[slug]/page.tsx");
    const publicLoader = read("apps/web/src/lib/synthesis-editorial.ts");
    const editorialPanel = read("apps/web/src/app/editorial/SynthesisDraftPanel.tsx");
    expect(page).toContain("SYNTHESIS_PUBLIC_AI_LABEL");
    expect(page).toContain("SYNTHESIS_PUBLIC_SCOPE_NOTICE");
    expect(page).not.toContain("AI-written synthesis");
    expect(page).not.toContain("AI-generated, editor-approved");
    expect(page).not.toContain("isExample={false}");
    expect(page).toContain("synthesis.freshness.status");
    expect(publicLoader).toContain("version.isExample !== false");
    expect(publicLoader).toContain("isExample: false");
    expect(editorialPanel).toContain("draft.document.sections.map");
    expect(editorialPanel).toContain('type="checkbox"');
    expect(editorialPanel).toContain("synthesisDraftDecisionSchema.safeParse");
    expect(editorialPanel).not.toContain('licenseSpdx: "CC-BY-4.0"');
    expect(editorialPanel).not.toMatch(/Reviewed:\s*true/);

    for (const document of [
      "docs/synthesis-governance.md",
      "docs/synthesis-editorial.md",
      "docs/agent-governance.md",
      "docs/editorial-governance.md",
      "docs/poc-limitations.md",
      "docs/operations/privacy-and-takedown.md",
      "README.md",
    ]) {
      expectLocalMarkdownLinksResolve(document);
    }
  });
});
