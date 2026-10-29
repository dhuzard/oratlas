import { describe, expect, it } from "vitest";
import {
  createCapturedFixtureTransport,
  inspectRepository,
  verifyCapturedFixture,
  type CapturedRepositoryFixture,
} from "@oratlas/github";
import { enrichMetadataFromZenodo, projectSourceEvidenceLinks, runExtraction } from "./index.js";
import crtJson from "./fixtures/ethical-debt-v0.1.0-trust-preview.3/fixture.json" with { type: "json" };
import ntsJson from "./fixtures/source-pilot/nts/fixture.json" with { type: "json" };
import hcmJson from "./fixtures/source-pilot/hcm/fixture.json" with { type: "json" };
import hcmReleaseJson from "./fixtures/source-pilot/hcm-release/fixture.json" with { type: "json" };

const cases = [
  {
    name: "CRT frozen release",
    fixture: crtJson,
    commit: "955e2994e0c6a042be80851b2125c2064c211dcf",
    repositoryId: "1291083149",
    digest: "9f13f8dfc35cca0cf0a602b3304bcc0c9fe94e751c448d020b63e789f27abb23",
    counts: [529, 994, 1392, 1392],
  },
  {
    name: "DiggyPaper NTS",
    fixture: ntsJson,
    commit: "b957ced01f0ff80fefcb08e5bebbdfe321383863",
    repositoryId: "1437255500",
    digest: "e535a01d649ba483dc23cce25294d168e1e7084cf0c83e577a3bfbee12ba4c95",
    counts: [4, 4, 4, 0],
  },
  {
    name: "Murmuration HCM",
    fixture: hcmJson,
    commit: "a906c5f15e77b8a4ac0671c9df15f75b8095029f",
    repositoryId: "1437035846",
    digest: "39e96a9d7cbb30f0e4d7ae6e1a8b2562eecd125db5aa90896397e6e414ddc37c",
    counts: [58, 5, 58, 0],
  },
];
async function preview(value: unknown) {
  const fixture = value as CapturedRepositoryFixture;
  const report = await inspectRepository(fixture.repository.canonicalUrl, {
    transport: createCapturedFixtureTransport(fixture),
    source:
      fixture.source.kind === "release"
        ? { kind: "release", tag: fixture.source.releaseTag! }
        : { kind: "default-branch" },
    now: () => new Date(0),
  });
  return { report, extraction: runExtraction(report, () => new Date(0)) };
}
const lines = (content: string): Array<Record<string, string>> =>
  content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const sidecarPath = "knowledge/oratlas/source-native-trust.json";
const nts = ntsJson as CapturedRepositoryFixture;
const nativeSidecar = nts.files[sidecarPath]!.content;
function project(content = nativeSidecar, stale = false) {
  const claim = lines(nts.files["knowledge/oratlas/claims.jsonl"]!.content)[0]!;
  return projectSourceEvidenceLinks({
    claimLocalId: claim.id!,
    claimText: claim.text! + (stale ? " changed" : ""),
    sidecar: { path: sidecarPath, content },
    claimGraphContent: nts.files["knowledge/claim_graph.json"]!.content,
    trustReportContent: nts.files["knowledge/trust_score_report.json"]!.content,
    citations: lines(nts.files["knowledge/oratlas/citations.jsonl"]!.content).map((citation) => ({
      localCitationId: citation.id!,
      doi: citation.doi ?? null,
      doiIsExample: false,
    })),
    relations: lines(nts.files["knowledge/oratlas/relations.jsonl"]!.content)
      .filter((relation) => relation.claimId === claim.id)
      .map((relation) => ({
        citationLocalId: relation.citationId!,
        relationType: relation.relationType!,
        sourceLocation: relation.sourceLocation ?? null,
      })),
  });
}

describe("three-source read-only import preview (#264)", () => {
  it("does not attach the older rc.2 Zenodo DOI to the frozen CRT preview release", async () => {
    const { report, extraction } = await preview(crtJson);
    expect(report.selectedSource?.releaseTag).toBe("v0.1.0-trust-preview.3");
    expect(extraction.metadata.fields.versionDoi).toBeUndefined();
    const enriched = enrichMetadataFromZenodo(extraction.metadata, report, {
      recordId: "21549715",
      doi: "10.5281/zenodo.21549715",
      conceptRecordId: "21549714",
      conceptDoi: "10.5281/zenodo.21549714",
      versionTag: "0.1.0-rc.2",
      creators: ["Huzard, Damien"],
      relatedUrls: ["https://github.com/dhuzard/ethical-debt-AI-review"],
    });
    expect(enriched).toBe(extraction.metadata);
    expect(enriched.fields.versionDoi).toBeUndefined();
    expect(enriched.fields.zenodoRecordId).toBeUndefined();
  });

  it("preserves the additive HCM published release selection and annotated tag binding", async () => {
    expect(() => verifyCapturedFixture(hcmReleaseJson as CapturedRepositoryFixture)).not.toThrow();
    expect(hcmReleaseJson.pin).toEqual({ kind: "release", value: "v0.1.0" });
    expect(hcmReleaseJson.manifestSha256).toBe(
      "9c6a1277b5fea5fa6710affb233f082cacdbdc2560295c4e34dd04fd83fa470b",
    );
    const { report, extraction } = await preview(hcmReleaseJson);
    expect(report.status).toBe("succeeded");
    expect(report.selectedSource).toMatchObject({
      kind: "release",
      releaseTag: "v0.1.0",
      releaseUrl: "https://github.com/dhuzard/hcm-circadian-mouse-review/releases/tag/v0.1.0",
      commitSha: "a906c5f15e77b8a4ac0671c9df15f75b8095029f",
      treeSha: "1df78fd454940b4d210748a0ebe6d171c43fe435",
      tagObjectSha: "b26d0f8fc90c137c4f990ab038a152fdda87ea44",
    });
    expect(hcmReleaseJson.files).toEqual(hcmJson.files);
    expect(hcmJson.source.kind).toBe("default-branch");
    expect(hcmReleaseJson.manifestSha256).not.toBe(hcmJson.manifestSha256);
    const { claims, citations, relations, trust } = extraction.knowledge;
    expect([claims.length, citations.length, relations.length, trust.length]).toEqual([
      58, 5, 58, 0,
    ]);
    for (const path of [
      "source/run/final_report.md",
      "knowledge/oratlas/report.md",
      "source/run/mapppp_bundle.json",
    ])
      expect(hcmReleaseJson.files).not.toHaveProperty(path);
    const tampered = structuredClone(hcmReleaseJson);
    tampered.source.tagObjectSha = "0".repeat(40);
    expect(() => createCapturedFixtureTransport(tampered as CapturedRepositoryFixture)).toThrow(
      /integrity/,
    );
  });

  it.each(cases)(
    "replays $name with exact identity, source bytes and counts",
    async ({ fixture, commit, repositoryId, digest, counts }) => {
      expect(() => verifyCapturedFixture(fixture as CapturedRepositoryFixture)).not.toThrow();
      expect(fixture.source.commitSha).toBe(commit);
      expect(fixture.repository.githubRepositoryId).toBe(repositoryId);
      expect(fixture.manifestSha256).toBe(digest);
      const { report, extraction } = await preview(fixture);
      expect(report.selectedSource?.commitSha).toBe(commit);
      expect(report.status).toBe(fixture === crtJson ? "partial" : "succeeded");
      const { claims, citations, relations, trust } = extraction.knowledge;
      expect([claims.length, citations.length, relations.length, trust.length]).toEqual(counts);
      expect(JSON.parse(fixture.files["review-manifest.json"].content).schemaVersion).toBe("1.0.0");
    },
  );

  it("rejects changed bytes and changed capture identity before replay", () => {
    const bytes = structuredClone(nts);
    bytes.files["review-manifest.json"]!.content += " ";
    expect(() => createCapturedFixtureTransport(bytes)).toThrow(/integrity/);
    const stale = structuredClone(nts);
    stale.source.commitSha = "0".repeat(40);
    expect(() => createCapturedFixtureTransport(stale)).toThrow(/integrity/);
  });

  it("preserves declared contributor/contact ORCID only where source metadata declares it", () => {
    const manifest = JSON.parse(crtJson.files["review-manifest.json"].content);
    expect(manifest.contact.orcid).toBe("0000-0003-4820-7951");
    expect(manifest.contributors[0].orcid).toBe(manifest.contact.orcid);
    for (const fixture of [ntsJson, hcmJson]) {
      const other = JSON.parse(fixture.files["review-manifest.json"].content);
      expect(other.contact).toBeUndefined();
      expect(other.contributors).toBeUndefined();
    }
  });

  it("does not invent a common citation DOI across the three exports", async () => {
    const sets = await Promise.all(
      cases.map(async ({ fixture }) => {
        const { extraction } = await preview(fixture);
        return new Set(
          extraction.knowledge.citations
            .map((citation) => citation.doi?.toLowerCase())
            .filter(Boolean),
        );
      }),
    );
    for (let i = 0; i < sets.length; i++)
      for (let j = i + 1; j < sets.length; j++) {
        expect([...sets[i]!].filter((doi) => sets[j]!.has(doi))).toEqual([]);
      }
  });

  it("rejects malformed and stale NTS lineage", () => {
    expect(project("{").status).toBe("sidecar-invalid");
    expect(project(nativeSidecar, true).status).toBe("sidecar-stale");
    expect(project(nativeSidecar, true).citations).toEqual([]);
  });

  it("keeps same-paper candidates apart from reviewed claim mappings", () => {
    const source = JSON.parse(nativeSidecar);
    for (const link of source.evidence_links) {
      link.binding = "same-paper-candidate";
      delete link.mappings;
      delete link.phase2_finding_sha256;
    }
    const result = project(JSON.stringify(source));
    expect(result.citations.flatMap((citation) => citation.findings)).toEqual([]);
    expect(
      result.citations.flatMap((citation) => citation.candidateFindings).length,
    ).toBeGreaterThan(0);
  });

  it("preserves rights withholding and never includes passage text in lineage projections", () => {
    const source = JSON.parse(nativeSidecar);
    for (const link of source.evidence_links)
      for (const passage of link.passages ?? []) passage.quote_state = "withheld-rights";
    const result = project(JSON.stringify(source));
    const findings = result.citations.flatMap((citation) => [
      ...citation.findings,
      ...citation.candidateFindings,
    ]);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings)
      for (const passage of finding.passages ?? []) {
        expect(passage.quoteState).toBe("withheld-rights");
        expect(passage).not.toHaveProperty("text");
        expect(passage).not.toHaveProperty("quote");
      }
  });

  it("reports HCM report context as uncaptured and preserves producer omissions", () => {
    expect(hcmJson.tree.some((entry) => entry.path === "source/run/final_report.md")).toBe(true);
    expect(hcmJson.files).not.toHaveProperty("source/run/final_report.md");
    const provenance = JSON.parse(hcmJson.files["knowledge/oratlas/provenance.json"].content);
    expect(provenance.murmurationCommit).toBe("f14d167571a392979958fa4e2a8b33faf24b8d77");
    expect(provenance.skipped.length).toBeGreaterThan(0);
  });
});
