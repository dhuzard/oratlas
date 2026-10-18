import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFakeTransport, inspectRepository } from "@oratlas/github";
import {
  sourceEvidenceLinksSchema,
  type InspectionReport,
  type SourceEvidenceLinks,
} from "@oratlas/contracts";
import {
  auditSourceEvidencePacket,
  projectSourceEvidenceLinks,
  runExtraction,
  type PacketLinkClaim,
} from "./index.js";
import {
  LINEAGE_CLAIM_ID,
  REVIEW_REPOSITORY,
  loadEvidenceLineageFixture,
  reviewRepoTransportFixture,
} from "./fixtures/evidence-lineage.js";

/**
 * Offline regression for the Diggypaper → ComputationalReviewTemplate → ORAtlas pipeline
 * (issue #198, MVP Gate G4). Every input is a committed, digest-pinned fixture built by
 * scripts/evidence-lineage/build-fixture.mjs from the exact upstream revisions in pins.json.
 */
const fixture = loadEvidenceLineageFixture();
const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const SIDECAR_PATH = "knowledge/oratlas/source-native-trust.json";
const lines = (text: string) =>
  text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

async function inspect(files: Record<string, string>): Promise<InspectionReport> {
  return inspectRepository(REVIEW_REPOSITORY.url, {
    transport: createFakeTransport(reviewRepoTransportFixture(files)),
    now: () => new Date(0),
  });
}

/** Run the projection for one claim exactly as the public passport does, from extracted records. */
function project(
  files: Record<string, string>,
  claimId = LINEAGE_CLAIM_ID,
  mutateSidecar?: (sidecar: Record<string, unknown>) => void,
): SourceEvidenceLinks {
  const claims = lines(files["knowledge/oratlas/claims.jsonl"]!);
  const citations = lines(files["knowledge/oratlas/citations.jsonl"]!);
  const relations = lines(files["knowledge/oratlas/relations.jsonl"]!);
  let sidecarText = files[SIDECAR_PATH]!;
  if (mutateSidecar) {
    const parsed = JSON.parse(sidecarText) as Record<string, unknown>;
    mutateSidecar(parsed);
    sidecarText = JSON.stringify(parsed);
  }
  return projectSourceEvidenceLinks({
    claimLocalId: claimId,
    claimText: claims.find((claim) => claim.id === claimId).text,
    sidecar: { path: SIDECAR_PATH, content: sidecarText },
    claimGraphContent: files["knowledge/claim_graph.json"],
    citations: citations.map((citation) => ({
      localCitationId: citation.id,
      doi: citation.doi ?? null,
      doiIsExample: false,
    })),
    relations: relations
      .filter((relation) => relation.claimId === claimId)
      .map((relation) => ({
        citationLocalId: relation.citationId,
        relationType: relation.relationType,
        sourceLocation: relation.sourceLocation ?? null,
      })),
  });
}

describe("fixture pins and digests", () => {
  it("records exact upstream revisions for all three repositories", () => {
    for (const [name, pin] of Object.entries(fixture.pins.pins)) {
      expect(pin.commit, name).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(fixture.pins.pins.diggypaper!.commit).toBe("d7e97e375de75c4e67cd94e0f4efb078f8f4282f");
    expect(fixture.pins.pins.computationalReviewTemplate!.commit).toBe(
      "471ef85bb76e5940a702dee06fcebfd4f6a08669",
    );
    expect(fixture.pins.pins.oratlas!.commit).toBe("9cd3a0c284400b30dd0044cf3acb24df1047275d");
  });

  it("matches the committed digest manifest byte for byte, with no extra or missing file", () => {
    const committed = Object.keys(fixture.digests.files).sort();
    const present = Object.keys(fixture.all)
      .filter((path) => path !== "digests.json")
      .sort();
    expect(present).toEqual(committed);
    for (const [path, digest] of Object.entries(fixture.digests.files)) {
      expect(sha256Hex(fixture.all[path]!), path).toBe(digest.sha256);
      expect(Buffer.byteLength(fixture.all[path]!, "utf8"), path).toBe(digest.bytes);
    }
  });

  it("contains no PDF, full text or credential material", () => {
    for (const path of Object.keys(fixture.all)) expect(path).not.toMatch(/\.pdf$/i);
    for (const [path, content] of Object.entries(fixture.all)) {
      expect(content, path).not.toMatch(/ghp_|github_pat_|BEGIN [A-Z ]*PRIVATE KEY/);
    }
    const papers = lines(fixture.packetFiles["papers.jsonl"]!);
    expect(papers.every((paper) => paper.rights.full_text_included === false)).toBe(true);
  });
});

describe("repository inspection → manifest → extractKnowledgeWithOutcomes", () => {
  it("ingests the real exported JSONL with zero skipped records and no ORAtlas TRUST", async () => {
    const report = await inspect(fixture.reviewFiles);
    expect(report.status).toBe("succeeded");
    const extraction = runExtraction(report, () => new Date(0));
    expect(extraction.manifest?.artifacts).toEqual({
      claims: "knowledge/oratlas/claims.jsonl",
      citations: "knowledge/oratlas/citations.jsonl",
      relations: "knowledge/oratlas/relations.jsonl",
      provenance: SIDECAR_PATH,
    });
    expect(extraction.knowledge.warnings).toEqual([]);
    expect(extraction.knowledge.claims.map((claim) => claim.id).sort()).toEqual(
      lines(fixture.reviewFiles["knowledge/oratlas/claims.jsonl"]!)
        .map((claim) => claim.id)
        .sort(),
    );
    expect(extraction.knowledge.relations).toHaveLength(5);
    expect(extraction.compatibility.artifactOutcomes).toMatchObject({
      claims: { status: "loaded", loadedCount: 4, skippedCount: 0 },
      citations: { status: "loaded", loadedCount: 5, skippedCount: 0 },
      relations: { status: "loaded", loadedCount: 5, skippedCount: 0 },
      trust: { status: "not-declared", loadedCount: 0 },
    });
    // Native TRUST v2 is preserved in the sidecar and never becomes an ORAtlas assessment.
    expect(extraction.knowledge.trust).toEqual([]);
    // The sidecar is captured byte-for-byte for preservation.
    expect(report.files[SIDECAR_PATH]?.content).toBe(fixture.reviewFiles[SIDECAR_PATH]);
  });

  it("keeps the multi-citation claim's native ids and distinct relation types", async () => {
    const extraction = runExtraction(await inspect(fixture.reviewFiles), () => new Date(0));
    const relations = extraction.knowledge.relations.filter(
      (relation) => relation.claimId === LINEAGE_CLAIM_ID,
    );
    expect(
      relations.map((relation) => [relation.citationId, relation.relationType]).sort(),
    ).toEqual([
      ["Cardin2009", "supports"],
      ["Sohal2009", "partially-supports"],
    ]);
  });

  it("reports a declared-but-missing JSONL artifact instead of substituting another", async () => {
    const files = { ...fixture.reviewFiles };
    delete files["knowledge/oratlas/relations.jsonl"];
    const extraction = runExtraction(await inspect(files), () => new Date(0));
    expect(extraction.knowledge.relations).toEqual([]);
    expect(extraction.compatibility.artifactOutcomes?.relations).toMatchObject({
      status: expect.stringMatching(/skipped|invalid/),
      loadedCount: 0,
    });
  });

  it("surfaces invalid JSONL lines as skipped records with the file named", async () => {
    const files = { ...fixture.reviewFiles };
    files["knowledge/oratlas/relations.jsonl"] =
      `${files["knowledge/oratlas/relations.jsonl"]}{"claimId": not json}\n`;
    const extraction = runExtraction(await inspect(files), () => new Date(0));
    expect(extraction.knowledge.relations).toHaveLength(5);
    expect(extraction.knowledge.warnings.join("\n")).toContain("relations");
    expect(extraction.compatibility.artifactOutcomes?.relations?.skippedCount).toBe(1);
  });

  it("drops a relation edge to an unknown citation rather than inventing one", async () => {
    const files = { ...fixture.reviewFiles };
    files["knowledge/oratlas/relations.jsonl"] =
      `${files["knowledge/oratlas/relations.jsonl"]}${JSON.stringify({
        claimId: LINEAGE_CLAIM_ID,
        citationId: "Nobody1999",
        relationType: "supports",
      })}\n`;
    const extraction = runExtraction(await inspect(files), () => new Date(0));
    expect(extraction.knowledge.relations).toHaveLength(5);
    expect(extraction.knowledge.warnings.join("\n")).toContain("unknown claim or citation");
  });
});

describe("claim → citations → producer findings (sidecar projection)", () => {
  it("follows one review claim to two papers: reviewed findings apart from a same-paper candidate", () => {
    const links = project(fixture.reviewFiles);
    expect(sourceEvidenceLinksSchema.parse(links)).toEqual(links);
    expect(links.status).toBe("linked");
    expect(links.rejected).toEqual([]);
    expect(links.citations.map((citation) => citation.citationLocalId)).toEqual([
      "Cardin2009",
      "Sohal2009",
    ]);
    const cardin = links.citations[0]!;
    const sohal = links.citations[1]!;
    // Two findings from one article (Cardin), with distinct ids and no collision. Only the one a
    // reviewed decision maps to this claim is its evidence; the other is a same-paper candidate.
    expect(cardin.findings.map((finding) => finding.findingId)).toEqual(["finding:cardin2009-f1"]);
    expect(cardin.candidateFindings.map((finding) => finding.findingId)).toEqual([
      "finding:cardin2009-f2",
    ]);
    expect(sohal.findings.map((finding) => finding.findingId)).toEqual(["finding:sohal2009-f1"]);
    expect(sohal.candidateFindings).toEqual([]);
    expect(cardin.findings[0]).toMatchObject({
      binding: "reviewed-mapping",
      phase2FindingSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      mapping: { decisionRef: "fixture:oratlas-198/map-001", assertedAt: "2026-01-03T00:00:00Z" },
    });
    expect(cardin.candidateFindings[0]).toMatchObject({
      binding: "same-paper-candidate",
      phase2FindingSha256: null,
      mapping: null,
    });
    // The review's own relations are carried unchanged next to the producer findings.
    expect(cardin.relation).toMatchObject({
      relationType: "supports",
      sourceLocation: "Abstract, page 1",
    });
    expect(sohal.relation.relationType).toBe("partially-supports");
    // Independence is not invented: both findings of one article share one source snapshot digest.
    expect(cardin.findings[0]!.sourceSnapshotSha256).toBe(
      cardin.candidateFindings[0]!.sourceSnapshotSha256,
    );
    expect(sohal.findings[0]!.sourceSnapshotSha256).not.toBe(
      cardin.findings[0]!.sourceSnapshotSha256,
    );
    // Passage-level data is the producer's declaration: digests and match state, never quote text.
    const first = cardin.findings[0]!;
    expect(first).toMatchObject({
      producer: "diggypaper",
      revision: 1,
      verificationLevel: "source-verified",
      passageEvidence: "declared-by-sidecar",
      producerAssessment: "declared-by-sidecar",
      passages: [
        {
          passageId: "passage:cardin2009-p1",
          quoteSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
          quoteState: "included",
          matchStatus: "exact",
        },
      ],
      assessments: [{ protocol: "seip-support-v1", status: "supports" }],
    });
    expect(JSON.stringify(links)).not.toContain("SYNTHETIC FIXTURE]");
    // An example DOI locator is declared but never offered as an outbound link.
    expect(links.packets).toEqual([
      expect.objectContaining({
        packetId: "packet:oratlas-198-lineage-fixture",
        availability: "locator-declared",
        locator: {
          kind: "doi",
          doi: "10.5555/oratlas.fixture.packet",
          url: null,
          href: null,
          doiIsExample: true,
        },
        contentsImportedByOratlas: false,
        contentsVerifiedByOratlas: false,
      }),
    ]);
  });

  it("labels native TRUST v2 as source-native and never as an ORAtlas assessment", () => {
    const links = project(fixture.reviewFiles);
    expect(links.nativeAssessment).toMatchObject({
      protocol: "computational-review-trust",
      rubricVersion: "2.0.0",
      origin: "source-native",
      reAdjudicatedByOratlas: false,
      isOratlasAssessment: false,
    });
    expect(links.labels.nativeAssessment).toMatch(/not an ORAtlas TRUST assessment/);
    expect(links.labels.producer).toMatch(/not a claim of this review/);
    expect(JSON.stringify(links)).not.toMatch(/verified by oratlas|peer reviewed|confirmed/i);
  });

  it("reports claims with no producer finding explicitly rather than hiding them", () => {
    const other = project(fixture.reviewFiles, "clm_3ea62e8a65cbdb75");
    expect(other.status).toBe("no-producer-finding");
    expect(other.citations).toEqual([]);
    expect(other.rejected).toEqual([]);
  });

  it("is independent of record order (reordered JSONL lines and sidecar links)", () => {
    const baseline = project(fixture.reviewFiles);
    const reordered = { ...fixture.reviewFiles };
    for (const path of [
      "knowledge/oratlas/claims.jsonl",
      "knowledge/oratlas/citations.jsonl",
      "knowledge/oratlas/relations.jsonl",
    ]) {
      reordered[path] =
        `${fixture.reviewFiles[path]!.split("\n").filter(Boolean).reverse().join("\n")}\n`;
    }
    const projected = project(reordered, LINEAGE_CLAIM_ID, (sidecar) => {
      (sidecar.evidence_links as unknown[]).reverse();
      (sidecar.claims as unknown[]).reverse();
    });
    expect(projected).toEqual({
      ...baseline,
      // The sidecar bytes legitimately differ once re-serialised; everything derived must not.
      sidecar: projected.sidecar,
    });
  });

  it("collapses an identical duplicate import without inventing independence", () => {
    const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
      const records = sidecar.evidence_links as unknown[];
      sidecar.evidence_links = [...records, ...records];
    });
    expect(links).toEqual({ ...project(fixture.reviewFiles), sidecar: links.sidecar });
    expect(links.rejected).toEqual([]);
  });
});

describe("packet locator and schema compatibility", () => {
  const edit = (change: (links: Array<Record<string, unknown>>) => void) =>
    project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) =>
      change(sidecar.evidence_links as Array<Record<string, unknown>>),
    );

  it("links a real DOI locator through doi.org and a GitHub release asset as declared", () => {
    const doi = edit((records) => {
      for (const record of records)
        record.packet_locator = { kind: "doi", doi: "10.5281/zenodo.1234567" };
    });
    expect(doi.packets[0]).toMatchObject({
      availability: "locator-declared",
      locator: {
        doi: "10.5281/zenodo.1234567",
        href: "https://doi.org/10.5281/zenodo.1234567",
        doiIsExample: false,
      },
    });
    const url = "https://github.com/org/packets/releases/download/v1.0.0/packet.tar";
    const asset = edit((records) => {
      for (const record of records) record.packet_locator = { kind: "github-release-asset", url };
    });
    expect(asset.packets[0]!.locator).toMatchObject({
      kind: "github-release-asset",
      url,
      href: url,
    });
  });

  it("rejects look-alike or non-https locators as invalid link records", () => {
    for (const url of [
      "http://github.com/org/r/releases/download/v1/p",
      "https://github.com/org/r/blob/main/p",
      "https://evil.example/https://github.com/org/r/releases/download/v1/p",
      "https://github.com/org/r/releases/download/v1/p?x=1",
    ]) {
      const links = edit((records) => {
        records[0]!.packet_locator = { kind: "github-release-asset", url };
      });
      expect(links.rejected, url).toContainEqual({
        findingId: "finding:cardin2009-f1",
        citeKey: "Cardin2009",
        reason: "invalid-link-record",
      });
    }
  });

  it("still projects a links/1 sidecar and says passage data is not carried", () => {
    const links = edit((records) => {
      for (const record of records) {
        for (const key of [
          "packet_locator",
          "binding",
          "mappings",
          "phase2_finding_sha256",
          "finding_revision",
          "verification_level",
          "passages",
          "assessments",
        ]) {
          delete record[key];
        }
      }
    });
    // A links/1 sidecar cannot say a finding was reviewed for this claim: candidates only.
    expect(links.status).toBe("candidates-only");
    expect(links.citations.every((citation) => citation.findings.length === 0)).toBe(true);
    expect(links.packets[0]).toMatchObject({
      availability: "location-not-declared",
      locator: null,
    });
    expect(links.citations[0]!.candidateFindings[0]).toMatchObject({
      binding: "binding-not-declared",
      mapping: null,
      revision: null,
      verificationLevel: null,
      passageEvidence: "not-carried-by-sidecar",
      passages: null,
      producerAssessment: "not-carried-by-sidecar",
      assessments: null,
    });
  });

  it("rejects a record that declares passage fields only partly", () => {
    const links = edit((records) => {
      delete records[0]!.passages;
    });
    expect(links.rejected).toContainEqual({
      findingId: "finding:cardin2009-f1",
      citeKey: "Cardin2009",
      reason: "invalid-link-record",
    });
  });

  it("treats two declared revisions of one finding as ambiguous", () => {
    const links = edit((records) => {
      records.push({ ...records[0]!, finding_revision: 2 });
    });
    expect(
      links.rejected
        .filter((link) => link.findingId === "finding:cardin2009-f1")
        .map((l) => l.reason),
    ).toEqual(["ambiguous-source-relationship", "ambiguous-source-relationship"]);
  });
});

describe("failure cases never surface as lineage", () => {
  const firstLink = (sidecar: Record<string, unknown>) =>
    (sidecar.evidence_links as Array<Record<string, unknown>>)[0]!;

  it("rejects a wrong DOI", () => {
    const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
      firstLink(sidecar).doi = "10.1038/nature99999";
    });
    expect(links.rejected).toContainEqual({
      findingId: "finding:cardin2009-f1",
      citeKey: "Cardin2009",
      reason: "doi-mismatch",
    });
    expect(
      links.citations.flatMap((citation) => citation.findings).map((finding) => finding.findingId),
    ).not.toContain("finding:cardin2009-f1");
    // The other finding of the same citation is unaffected (and stays a candidate).
    expect(links.citations[0]!.candidateFindings.map((finding) => finding.findingId)).toEqual([
      "finding:cardin2009-f2",
    ]);
  });

  it("rejects a link whose citation has no claim→citation relation edge", () => {
    const files = { ...fixture.reviewFiles };
    files["knowledge/oratlas/relations.jsonl"] = `${lines(
      files["knowledge/oratlas/relations.jsonl"]!,
    )
      .filter(
        (relation) =>
          !(relation.claimId === LINEAGE_CLAIM_ID && relation.citationId === "Sohal2009"),
      )
      .map((relation) => JSON.stringify(relation))
      .join("\n")}\n`;
    const links = project(files);
    expect(links.rejected).toEqual([
      { findingId: "finding:sohal2009-f1", citeKey: "Sohal2009", reason: "no-citation-relation" },
    ]);
    expect(links.citations.map((citation) => citation.citationLocalId)).toEqual(["Cardin2009"]);
  });

  it("rejects a link to a citation the review does not contain", () => {
    const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
      firstLink(sidecar).cite_key = "Ghost2020";
    });
    expect(links.rejected).toContainEqual({
      findingId: "finding:cardin2009-f1",
      citeKey: "Ghost2020",
      reason: "citation-not-in-review",
    });
  });

  it("rejects an ambiguous source relationship in full instead of choosing", () => {
    const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
      const records = sidecar.evidence_links as Array<Record<string, unknown>>;
      // The same finding id is bound to a second, different article.
      records.push({ ...records[0]!, cite_key: "Sohal2009", doi: "10.1038/nature07991" });
    });
    const rejected = links.rejected.filter((link) => link.findingId === "finding:cardin2009-f1");
    expect(rejected).toHaveLength(2);
    expect(rejected.every((link) => link.reason === "ambiguous-source-relationship")).toBe(true);
    expect(
      links.citations.flatMap((citation) => citation.findings).map((finding) => finding.findingId),
    ).not.toContain("finding:cardin2009-f1");
  });

  it("rejects one packet id declared with two digests", () => {
    const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
      firstLink(sidecar).packet_sha256 = "0".repeat(64);
    });
    expect(links.status).toBe("no-producer-finding");
    expect(links.rejected).toHaveLength(3);
    expect(links.rejected.every((link) => link.reason === "ambiguous-source-relationship")).toBe(
      true,
    );
  });

  it("treats a sidecar exported for different claim text as stale and withholds everything", () => {
    const files = { ...fixture.reviewFiles };
    files["knowledge/oratlas/claims.jsonl"] = files["knowledge/oratlas/claims.jsonl"]!.replace(
      "Optogenetic studies in mice",
      "Optogenetic studies in rats",
    );
    const links = project(files);
    expect(links.status).toBe("sidecar-stale");
    expect(links.citations).toEqual([]);
    expect(links.nativeAssessment).toBeNull();
    expect(links.rejected.every((link) => link.reason === "claim-text-digest-mismatch")).toBe(true);
    expect(links.rejected).toHaveLength(3);
  });

  it("treats a sidecar bound to a different claim graph digest as stale", () => {
    const files = { ...fixture.reviewFiles };
    files["knowledge/claim_graph.json"] = `${files["knowledge/claim_graph.json"]} `;
    const links = project(files);
    expect(links.status).toBe("sidecar-stale");
    expect(links.rejected.every((link) => link.reason === "claim-graph-digest-mismatch")).toBe(
      true,
    );
  });

  it("reports a malformed link record that names the claim", () => {
    const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
      delete firstLink(sidecar).packet_sha256;
    });
    expect(links.rejected).toContainEqual({
      findingId: "finding:cardin2009-f1",
      citeKey: "Cardin2009",
      reason: "invalid-link-record",
    });
  });

  it("reports an unusable or absent sidecar without lineage", () => {
    const absent = projectSourceEvidenceLinks({
      claimLocalId: LINEAGE_CLAIM_ID,
      claimText: "x",
      citations: [],
      relations: [],
    });
    expect(absent).toMatchObject({ status: "sidecar-unavailable", sidecar: null, citations: [] });
    for (const content of ["{not json", JSON.stringify({ schema: "something-else/1" })]) {
      const invalid = projectSourceEvidenceLinks({
        claimLocalId: LINEAGE_CLAIM_ID,
        claimText: "x",
        sidecar: { path: SIDECAR_PATH, content },
        citations: [],
        relations: [],
      });
      expect(invalid.status).toBe("sidecar-invalid");
      expect(invalid.citations).toEqual([]);
    }
  });

  it("never flags an example DOI as an outbound-link candidate by omission", () => {
    const files = { ...fixture.reviewFiles };
    const links = projectSourceEvidenceLinks({
      claimLocalId: LINEAGE_CLAIM_ID,
      claimText: lines(files["knowledge/oratlas/claims.jsonl"]!).find(
        (c) => c.id === LINEAGE_CLAIM_ID,
      ).text,
      sidecar: { path: SIDECAR_PATH, content: files[SIDECAR_PATH]! },
      citations: [
        { localCitationId: "Cardin2009", doi: "10.1038/nature08002", doiIsExample: true },
        { localCitationId: "Sohal2009", doi: "10.1038/nature07991", doiIsExample: false },
      ],
      relations: [
        { citationLocalId: "Cardin2009", relationType: "supports", sourceLocation: null },
        { citationLocalId: "Sohal2009", relationType: "partially-supports", sourceLocation: null },
      ],
    });
    expect(links.citations.find((c) => c.citationLocalId === "Cardin2009")!.doiIsExample).toBe(
      true,
    );
  });
});

/** The fields the conflicting-duplicate cases rewrite; everything else is carried untouched. */
type MutableLink = Record<string, unknown> & {
  assessments: Array<{ status: string }>;
  verification_level: string;
  binding: string;
  mappings?: Array<{ basis: string }>;
  phase2_finding_sha256?: string;
};

describe("adversarial sidecars fail closed, never throw", () => {
  const withLinks = (entries: unknown[]) =>
    project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
      sidecar.evidence_links = [...(sidecar.evidence_links as unknown[]), ...entries];
    });
  const records = () =>
    structuredClone(
      JSON.parse(fixture.reviewFiles[SIDECAR_PATH]!).evidence_links as Array<
        Record<string, unknown>
      >,
    );
  const cardin1 = () => records().find((r) => r.finding_id === "finding:cardin2009-f1")!;

  it.each([
    ["null", null],
    ["an array", [1, 2]],
    ["a number", 7],
    ["a string", "finding:cardin2009-f1"],
    ["a boolean", true],
  ])("treats a sidecar whose evidence_links contain %s as invalid", (_label, entry) => {
    expect(() => withLinks([entry])).not.toThrow();
    expect(withLinks([entry])).toMatchObject({ status: "sidecar-invalid", citations: [] });
  });

  it("treats non-object claim records as invalid", () => {
    for (const entry of [null, [], "x"]) {
      const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
        (sidecar.claims as unknown[]).push(entry);
      });
      expect(links.status).toBe("sidecar-invalid");
    }
  });

  it("reports malformed nested records without throwing", () => {
    for (const mutate of [
      (r: Record<string, unknown>) => (r.passages = [null]),
      (r: Record<string, unknown>) => (r.passages = "x"),
      (r: Record<string, unknown>) => (r.mappings = [{ claim_id: LINEAGE_CLAIM_ID }]),
      (r: Record<string, unknown>) => (r.assessments = [{ protocol: "trust-poc-1.0" }]),
      (r: Record<string, unknown>) => (r.packet_locator = { kind: "doi", doi: null }),
    ]) {
      const bad = cardin1();
      mutate(bad);
      const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
        sidecar.evidence_links = (sidecar.evidence_links as Array<Record<string, unknown>>).map(
          (r) => (r.finding_id === "finding:cardin2009-f1" ? bad : r),
        );
      });
      expect(links.rejected).toContainEqual({
        findingId: "finding:cardin2009-f1",
        citeKey: "Cardin2009",
        reason: "invalid-link-record",
      });
    }
  });

  it.each([
    ["human assessment", (r: MutableLink) => (r.assessments[0]!.status = "contradicts")],
    ["verification level", (r: MutableLink) => (r.verification_level = "human-reviewed")],
    ["mapping decision", (r: MutableLink) => (r.mappings![0]!.basis = "Another basis.")],
    [
      "binding",
      (r: MutableLink) => {
        r.binding = "same-paper-candidate";
        delete r.mappings;
        delete r.phase2_finding_sha256;
      },
    ],
  ])("rejects conflicting duplicates that differ only in %s, in either order", (_label, mutate) => {
    const conflicting = cardin1() as MutableLink;
    mutate(conflicting);
    for (const order of ["append", "prepend"]) {
      const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
        const list = sidecar.evidence_links as unknown[];
        sidecar.evidence_links =
          order === "append" ? [...list, conflicting] : [conflicting, ...list];
      });
      expect(
        links.rejected.filter((link) => link.findingId === "finding:cardin2009-f1"),
        order,
      ).toEqual([
        {
          findingId: "finding:cardin2009-f1",
          citeKey: "Cardin2009",
          reason: "ambiguous-source-relationship",
        },
        {
          findingId: "finding:cardin2009-f1",
          citeKey: "Cardin2009",
          reason: "ambiguous-source-relationship",
        },
      ]);
      expect(JSON.stringify(links.citations)).not.toContain("finding:cardin2009-f1");
    }
  });

  it("rejects one packet id declared with two locators, in either order", () => {
    for (const order of ["append", "prepend"]) {
      const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
        const list = sidecar.evidence_links as Array<Record<string, unknown>>;
        const other = {
          ...list.find((r) => r.finding_id === "finding:sohal2009-f1")!,
          packet_locator: { kind: "doi", doi: "10.5281/zenodo.999" },
        };
        sidecar.evidence_links =
          order === "append"
            ? [
                ...list.filter(
                  (r) => r !== list.find((x) => x.finding_id === "finding:sohal2009-f1"),
                ),
                other,
              ]
            : [other, ...list.filter((r) => r.finding_id !== "finding:sohal2009-f1")];
      });
      expect(links.status, order).not.toBe("linked");
      expect(links.packets).toEqual([]);
      expect(links.rejected.every((link) => link.reason === "ambiguous-source-relationship")).toBe(
        true,
      );
    }
  });

  it("rejects conflicting claim records instead of using the first", () => {
    for (const order of ["append", "prepend"]) {
      const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
        const claims = sidecar.claims as Array<{
          claim_id: string;
          trust_v2: { overall_score: number };
        }>;
        const twin = structuredClone(claims.find((c) => c.claim_id === LINEAGE_CLAIM_ID)!);
        twin.trust_v2.overall_score = 10;
        sidecar.claims = order === "append" ? [...claims, twin] : [twin, ...claims];
      });
      expect(links.status, order).toBe("sidecar-invalid");
      expect(links.nativeAssessment).toBeNull();
      expect(links.rejected.every((link) => link.reason === "claim-record-conflict")).toBe(true);
    }
  });

  it("collapses identical duplicate claim records", () => {
    const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
      const claims = sidecar.claims as unknown[];
      sidecar.claims = [...claims, ...structuredClone(claims)];
    });
    expect(links.status).toBe("linked");
  });

  it("refuses a link with no DOI for this DOI-based protocol", () => {
    const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
      const list = sidecar.evidence_links as Array<Record<string, unknown>>;
      list.find((r) => r.finding_id === "finding:cardin2009-f1")!.doi = null;
    });
    expect(links.rejected).toContainEqual({
      findingId: "finding:cardin2009-f1",
      citeKey: "Cardin2009",
      reason: "doi-unconfirmed",
    });
    expect(JSON.stringify(links.citations)).not.toContain("finding:cardin2009-f1");
  });
});

describe("native assessment provenance", () => {
  const base = (overrides: Partial<Parameters<typeof projectSourceEvidenceLinks>[0]> = {}) => {
    const claims = lines(fixture.reviewFiles["knowledge/oratlas/claims.jsonl"]!);
    return projectSourceEvidenceLinks({
      claimLocalId: LINEAGE_CLAIM_ID,
      claimText: claims.find((claim) => claim.id === LINEAGE_CLAIM_ID).text,
      sidecar: { path: SIDECAR_PATH, content: fixture.reviewFiles[SIDECAR_PATH]! },
      citations: [],
      relations: [],
      ...overrides,
    });
  };

  it("marks the value verified only when both frozen native sources were preserved and match", () => {
    const verified = base({
      claimGraphContent: fixture.reviewFiles["knowledge/claim_graph.json"],
      trustReportContent: fixture.reviewFiles["knowledge/trust_score_report.json"],
    });
    expect(verified.nativeAssessment).toMatchObject({
      verifiedAgainstPreservedSources: true,
      provenance: { claimGraph: "digest-matched", trustScoreReport: "digest-matched" },
    });
    const unverified = base();
    expect(unverified.nativeAssessment).toMatchObject({
      verifiedAgainstPreservedSources: false,
      provenance: { claimGraph: "not-preserved", trustScoreReport: "not-preserved" },
    });
  });

  it("withholds the value when the preserved TRUST report does not match", () => {
    const links = base({
      claimGraphContent: fixture.reviewFiles["knowledge/claim_graph.json"],
      trustReportContent: `${fixture.reviewFiles["knowledge/trust_score_report.json"]} `,
    });
    expect(links.nativeAssessment).toBeNull();
    expect(links.nativeAssessmentWithheld).toBe("trust-report-digest-mismatch");
  });
});

describe("externally preserved packet resolves to the exact passage and snapshot hash", () => {
  const claims = (): PacketLinkClaim[] => {
    const sidecar = JSON.parse(fixture.reviewFiles[SIDECAR_PATH]!);
    return sidecar.evidence_links.map((link: Record<string, string | null>) => ({
      findingId: link.finding_id as string,
      packetId: link.packet_id as string,
      packetSha256: link.packet_sha256 as string,
      sourceSha256: link.finding_source_sha256 as string,
      doi: link.doi,
      declared: {
        revision: link.finding_revision as unknown as number,
        verificationLevel: link.verification_level as string,
        passages: (link.passages as unknown as Array<Record<string, string>>).map((p) => ({
          passageId: p.passage_id!,
          quoteSha256: p.quote_sha256!,
          quoteState: p.quote_state!,
          matchStatus: p.match_status!,
        })),
        assessments: (link.assessments as unknown as Array<Record<string, string>>).map((a) => ({
          assessmentId: a.assessment_id!,
          protocol: a.protocol!,
          status: a.status!,
        })),
      },
    }));
  };
  const withPacket = (edit: (files: Record<string, string>) => void) => {
    const files = { ...fixture.packetFiles };
    edit(files);
    return auditSourceEvidencePacket(files, claims());
  };
  const codes = (result: ReturnType<typeof auditSourceEvidencePacket>) =>
    result.issues.map((issue) => issue.code);

  it("binds each declared finding to quote digest, match state and snapshot digest", () => {
    const result = auditSourceEvidencePacket(fixture.packetFiles, claims());
    expect(result).toMatchObject({ ok: true, issues: [] });
    expect(result.lineage.map((entry) => entry.findingId)).toEqual([
      "finding:cardin2009-f1",
      "finding:cardin2009-f2",
      "finding:sohal2009-f1",
    ]);
    const cardin1 = result.lineage[0]!;
    const passage = cardin1.passages[0]!;
    expect(passage).toMatchObject({
      passageId: "passage:cardin2009-p1",
      quoteState: "included",
      matchStatus: "exact",
    });
    const packetPassage = lines(fixture.packetFiles["passages.jsonl"]!).find(
      (record) => record.passage_id === passage.passageId,
    );
    expect(passage.quoteSha256).toBe(`sha256:${sha256Hex(packetPassage.quote)}`);
    expect(cardin1.snapshotSha256).toBe(
      `sha256:${claims().find((link) => link.findingId === cardin1.findingId)!.sourceSha256}`,
    );
    expect(cardin1.assessments[0]).toMatchObject({
      protocol: "seip-support-v1",
      status: "supports",
      assessedSnapshotSha256: cardin1.snapshotSha256,
    });
    // Native Diggypaper judgments stay Diggypaper judgments: no TRUST vocabulary appears.
    expect(JSON.stringify(result.lineage)).not.toMatch(/trust/i);
  });

  it("checks the sidecar's passage-level declaration against the packet", () => {
    const declaredClaims = claims();
    const bent = (change: (claim: PacketLinkClaim) => void) => {
      const copy = structuredClone(declaredClaims);
      change(copy[0]!);
      return codes(auditSourceEvidencePacket(fixture.packetFiles, copy));
    };
    expect(
      bent((c) => (c.declared!.passages[0]!.quoteSha256 = `sha256:${"0".repeat(64)}`)),
    ).toContain("passage-declaration-mismatch");
    expect(bent((c) => (c.declared!.passages[0]!.matchStatus = "ambiguous"))).toContain(
      "passage-declaration-mismatch",
    );
    expect(
      bent((c) =>
        c.declared!.passages.push({ ...c.declared!.passages[0]!, passageId: "passage:x" }),
      ),
    ).toContain("passage-set-mismatch");
    expect(bent((c) => (c.declared!.verificationLevel = "independently-verified"))).toContain(
      "verification-level-mismatch",
    );
    expect(bent((c) => (c.declared!.assessments[0]!.status = "contradicts"))).toContain(
      "assessment-set-mismatch",
    );
    expect(bent((c) => (c.declared!.revision = 2))).toContain("finding-not-in-packet");
  });

  it("flags a declaration that a later packet revision has superseded", () => {
    const files = { ...fixture.packetFiles };
    const records = lines(files["findings.jsonl"]!);
    records.push({ ...records[0], revision: 2 });
    files["findings.jsonl"] = `${records
      .map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).sort())))
      .join("\n")}\n`;
    const result = auditSourceEvidencePacket(files, claims());
    expect(codes(result)).toContain("finding-superseded");
  });

  it("matches the packet digest the sidecar declares", () => {
    const sidecar = JSON.parse(fixture.reviewFiles[SIDECAR_PATH]!);
    expect(sidecar.evidence_links[0].packet_sha256).toBe(
      sha256Hex(fixture.packetFiles["manifest.json"]!),
    );
  });

  it("fails on a stale packet digest (manifest changed after export)", () => {
    const result = withPacket((files) => {
      files["manifest.json"] = files["manifest.json"]!.replace("2026-01-01", "2026-01-03");
    });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("packet-digest-mismatch");
  });

  it("fails on a corrupted artifact and a missing artifact", () => {
    expect(codes(withPacket((files) => (files["passages.jsonl"] += " ")))).toEqual(
      expect.arrayContaining(["artifact-hash-mismatch", "artifact-length-mismatch"]),
    );
    expect(codes(withPacket((files) => delete files["assessments.jsonl"]))).toContain(
      "artifact-missing",
    );
  });

  it("fails on a wrong DOI and a wrong source digest declared by the sidecar", () => {
    const wrong = claims().map((link, index) =>
      index === 0 ? { ...link, doi: "10.1038/nature99999", sourceSha256: "0".repeat(64) } : link,
    );
    const result = auditSourceEvidencePacket(fixture.packetFiles, wrong);
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(expect.arrayContaining(["doi-mismatch", "source-sha-mismatch"]));
    expect(result.lineage.map((entry) => entry.findingId)).not.toContain("finding:cardin2009-f1");
  });

  it("fails when the declared finding is absent from the packet", () => {
    const result = auditSourceEvidencePacket(fixture.packetFiles, [
      { ...claims()[0]!, findingId: "finding:not-there" },
    ]);
    expect(codes(result)).toContain("finding-not-in-packet");
  });

  it("refuses a packet that is not public and an unsupported schema version", () => {
    const manifest = JSON.parse(fixture.packetFiles["manifest.json"]!);
    manifest.access_scope.level = "restricted";
    const restricted = auditSourceEvidencePacket(
      { ...fixture.packetFiles, "manifest.json": JSON.stringify(manifest) },
      [],
    );
    expect(codes(restricted)).toContain("packet-not-public");
    manifest.schema_version = "source-evidence-packet/0.2.0";
    const unsupported = auditSourceEvidencePacket(
      { ...fixture.packetFiles, "manifest.json": JSON.stringify(manifest) },
      [],
    );
    expect(codes(unsupported)).toEqual(["unsupported-schema-version"]);
  });

  it("never resolves the restricted, unreviewed finding and never returns quote text", () => {
    const result = auditSourceEvidencePacket(fixture.packetFiles, [
      {
        ...claims()[0]!,
        findingId: "finding:gebru2021-f1",
        sourceSha256: "0".repeat(64),
        doi: "10.1145/3458723",
      },
    ]);
    expect(codes(result)).toEqual(
      expect.arrayContaining(["finding-not-approved", "snapshot-not-captured"]),
    );
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC FIXTURE]");
    const sidecar = JSON.parse(fixture.reviewFiles[SIDECAR_PATH]!);
    expect(JSON.stringify(sidecar.evidence_links)).not.toContain("gebru2021");
  });

  it("flags a quote whose bytes no longer match its digest and a restricted-rights quote leak", () => {
    const tampered = withPacket((files) => {
      const passages = lines(files["passages.jsonl"]!);
      passages[0].quote = "tampered";
      const text = passages
        .map((passage) => JSON.stringify(Object.fromEntries(Object.entries(passage).sort())))
        .join("\n");
      files["passages.jsonl"] = `${text}\n`;
    });
    expect(codes(tampered)).toContain("quote-hash-mismatch");
  });
});

describe("native fields must follow the packet contract", () => {
  const editCardin1 = (change: (record: Record<string, unknown>) => void) =>
    project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
      const record = (sidecar.evidence_links as Array<Record<string, unknown>>).find(
        (r) => r.finding_id === "finding:cardin2009-f1",
      )!;
      change(record);
    });
  const invalid = {
    findingId: "finding:cardin2009-f1",
    citeKey: "Cardin2009",
    reason: "invalid-link-record",
  };

  it.each([
    [
      "an invented status",
      (r: Record<string, unknown>) =>
        ((r.assessments as Array<Record<string, unknown>>)[0]!.status = "trust-verified"),
    ],
    [
      "an unpatterned assessment id",
      (r: Record<string, unknown>) =>
        ((r.assessments as Array<Record<string, unknown>>)[0]!.assessment_id = "a1"),
    ],
    [
      "an unpatterned passage id",
      (r: Record<string, unknown>) =>
        ((r.passages as Array<Record<string, unknown>>)[0]!.passage_id = "p1"),
    ],
  ])("rejects %s", (_label, change) => {
    expect(editCardin1(change).rejected).toContainEqual(invalid);
  });

  it("rejects a links/2 record whose finding id is not a packet id", () => {
    const links = project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
      const record = (sidecar.evidence_links as Array<Record<string, unknown>>).find(
        (r) => r.finding_id === "finding:cardin2009-f1",
      )!;
      record.finding_id = "cardin2009-f1";
    });
    expect(links.rejected).toContainEqual({ ...invalid, findingId: "cardin2009-f1" });
  });
});

describe("sidecar records may not repeat judgments or carry impossible dates", () => {
  const editCardin1 = (change: (record: Record<string, unknown>) => void) =>
    project(fixture.reviewFiles, LINEAGE_CLAIM_ID, (sidecar) => {
      change(
        (sidecar.evidence_links as Array<Record<string, unknown>>).find(
          (r) => r.finding_id === "finding:cardin2009-f1",
        )!,
      );
    });
  const invalid = {
    findingId: "finding:cardin2009-f1",
    citeKey: "Cardin2009",
    reason: "invalid-link-record",
  };

  it.each([
    [
      "a repeated assessment id",
      (r: Record<string, unknown>) => {
        const list = r.assessments as unknown[];
        list.push(structuredClone(list[0]));
      },
    ],
    [
      "a repeated passage id",
      (r: Record<string, unknown>) => {
        const list = r.passages as unknown[];
        list.push(structuredClone(list[0]));
      },
    ],
    [
      "an impossible decision date",
      (r: Record<string, unknown>) => {
        (r.mappings as Array<Record<string, unknown>>)[0]!.asserted_at = "2026-13-40T25:61:61Z";
      },
    ],
    [
      "a non-leap-year Feb 29",
      (r: Record<string, unknown>) => {
        (r.mappings as Array<Record<string, unknown>>)[0]!.asserted_at = "2025-02-29T00:00:00Z";
      },
    ],
  ])("rejects %s", (_label, change) => {
    expect(editCardin1(change).rejected).toContainEqual(invalid);
  });
});
