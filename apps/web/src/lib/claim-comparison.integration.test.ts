import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type PrismaClient } from "@oratlas/db";
import type * as Comparison from "./claim-comparison";
import type * as SourceContext from "./claim-page-source-context";

vi.mock("server-only", () => ({}));

const databaseName = `.tmp-claim-comparison-${process.pid}-${Date.now()}.db`;
const databasePath = resolve(process.cwd(), "packages/db/prisma", databaseName);
const databaseUrl = `file:./${databaseName}`;
let prisma: PrismaClient;
let comparison: typeof Comparison;
let sourceContext: typeof SourceContext;
let leftVersion: string;
let rightVersion: string;
let withheldVersion: string;
let externalA: string;
let externalB: string;
const ref = (id: string) => `/claims/${id}/same-local-id`;
const externalRef = (id: string) => `/api/publication-claim-occurrences/${id}`;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.SESSION_SECRET = "comparison-fixture-secret-not-production";
  execFileSync(
    process.execPath,
    [
      resolve(process.cwd(), "packages/db/node_modules/prisma/build/index.js"),
      "db",
      "push",
      "--schema",
      "prisma/schema.prisma",
      "--skip-generate",
    ],
    {
      cwd: resolve(process.cwd(), "packages/db"),
      env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" },
      stdio: "pipe",
    },
  );
  ({ prisma } = await import("./db"));
  comparison = await import("./claim-comparison");
  sourceContext = await import("./claim-page-source-context");
  const repository = await prisma.repository.create({
    data: {
      owner: "comparison",
      name: "fixture",
      canonicalUrl: "https://github.com/comparison/fixture",
    },
  });
  const review = await prisma.review.create({
    data: {
      repositoryId: repository.id,
      slug: "comparison-fixture",
      title: "Synthetic comparison",
      status: "published",
    },
  });
  for (const [index, population] of ["rodent", "human", "secret population"].entries()) {
    const version = await prisma.reviewVersion.create({
      data: {
        reviewId: review.id,
        title: "Synthetic comparison",
        metadataJson: "{}",
        isExample: true,
        publicState: index === 2 ? "tombstoned" : "published",
      },
    });
    if (index === 0) leftVersion = version.id;
    if (index === 1) rightVersion = version.id;
    if (index === 2) withheldVersion = version.id;
    const claim = await prisma.claim.create({
      data: {
        reviewVersionId: version.id,
        localClaimId: "same-local-id",
        text: index === 2 ? "WITHHELD SECRET CLAIM" : "The intervention improves the outcome.",
        normalizedText: "the intervention improves the outcome.",
        scopeJson: JSON.stringify({ population, method: "declared method" }),
        section: "Results",
        anchor: "result-1",
      },
    });
    for (let occurrence = 0; occurrence < (index === 0 ? 2 : 1); occurrence++) {
      const citation = await prisma.citation.create({
        data: {
          reviewVersionId: version.id,
          localCitationId: `source-${occurrence}`,
          doi: "10.5555/repeated-source",
          title: "A repeated synthetic source",
        },
      });
      await prisma.claimEvidenceRelation.create({
        data: {
          claimId: claim.id,
          citationId: citation.id,
          relationType: index === 0 ? "supports" : "contradicts",
          sourceLocation: "content/review.md#L10",
        },
      });
    }
  }
  const publication = await prisma.publication.create({
    data: {
      stableKey: "comparison-publication",
      publicationType: "research-article",
      recordSource: "external-publication",
      identityEvidenceJson: "{}",
    },
  });
  for (const [index, host] of ["first.example", "second.example"].entries()) {
    const version = await prisma.publicationVersion.create({
      data: {
        publicationId: publication.id,
        stableKey: `comparison-version-${index}`,
        sourcesSha256: String(index + 1).repeat(64),
        adapterType: "myst",
        adapterBindingJson: JSON.stringify({
          type: "myst",
          protocolVersion: "0.2.0",
          crossReferenceInventoryPath: "xref.json",
          generatorName: "myst",
          generatorVersion: "1.0.0",
        }),
        structuralProvenance: "published-structure",
        observedAt: new Date(),
        observedPublicationBaseUrl: `https://${host}/`,
      },
    });
    const occurrence = await prisma.publicationClaimOccurrence.create({
      data: {
        publicationVersionId: version.id,
        sourceLocalClaimId: "same-local-id",
        stableKey: `comparison-occurrence-${index}`,
        text: "Identical external declaration.",
        targetJson: JSON.stringify({
          type: "myst-xref",
          identifier: "same-local-id",
          htmlId: "claim",
        }),
        publishedUrl: `https://${host}/paper/#claim`,
        declarationSha256: "d".repeat(64),
        declarationAuthority: "publication-source",
        sourceBindingJson: JSON.stringify({
          documentPath: "paper.md",
          documentSha256: "a".repeat(64),
          startLine: 2,
          endLine: 3,
          blockSha256: "b".repeat(64),
        }),
        selectorJson: JSON.stringify({
          representation: "oratlas-myst-source-utf8-v1",
          unit: "body",
          textQuote: { type: "TextQuoteSelector", exact: "Original passage" },
          textPosition: { type: "TextPositionSelector", start: 0, end: 16 },
        }),
      },
    });
    if (index === 0) externalA = occurrence.id;
    else externalB = occurrence.id;
  }
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  for (const path of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    if (existsSync(path)) rmSync(path);
  }
});

describe("bounded public exact claim comparison", () => {
  it("validates a single pending selection against the exact source and current visibility", async () => {
    const original = await comparison.getPublicComparisonClaim(ref(leftVersion));
    expect(original?.source.versionId).toBe(leftVersion);
    expect(original?.scope?.population).toBe("rodent");
    const context = await sourceContext.getClaimPageSourceContext(leftVersion, "same-local-id");
    expect(context?.versionId).toBe(leftVersion);
    expect(context?.scope?.population).toBe("rodent");
    expect(context?.preservedHref).toBe(`/reviews/comparison-fixture/versions/${leftVersion}`);
    expect(context?.locator).toBe("Results · result-1");
    expect(
      await sourceContext.getClaimPageSourceContext(withheldVersion, "same-local-id"),
    ).toBeNull();
    expect(await comparison.getPublicComparisonClaim(ref("missing"))).toBeNull();
    expect(await comparison.getPublicComparisonClaim(ref(withheldVersion))).toBeNull();
    expect(await comparison.getPublicComparisonClaim("/nodes/moving-alias")).toBeNull();
    expect(await comparison.getPublicComparisonClaim("https://example.test/claims/a/b")).toBeNull();
    try {
      await prisma.reviewVersion.update({
        where: { id: leftVersion },
        data: { publicState: "withdrawn" },
      });
      expect((await comparison.getPublicComparisonClaim(ref(leftVersion)))?.source.lifecycle).toBe(
        "withdrawn",
      );
      expect(
        (await sourceContext.getClaimPageSourceContext(leftVersion, "same-local-id"))?.lifecycle,
      ).toBe("withdrawn");
      await prisma.reviewVersion.update({
        where: { id: leftVersion },
        data: { publicState: "tombstoned" },
      });
      expect(await comparison.getPublicComparisonClaim(ref(leftVersion))).toBeNull();
      expect(
        await sourceContext.getClaimPageSourceContext(leftVersion, "same-local-id"),
      ).toBeNull();
      // A newer readable version with the same local claim ID is never substituted.
      expect(
        (await comparison.getPublicComparisonClaim(ref(rightVersion)))?.scope?.population,
      ).toBe("human");
    } finally {
      await prisma.reviewVersion.update({
        where: { id: leftVersion },
        data: { publicState: "published" },
      });
    }
    expect(await comparison.getPublicComparisonClaim(ref(leftVersion))).toEqual(original);
    expect(
      await comparison.getPublicClaimComparison(ref(leftVersion), ref(leftVersion)),
    ).toBeNull();
  });

  it("validates a single external occurrence without inventing a canonical binding", async () => {
    const selected = await comparison.getPublicComparisonClaim(externalRef(externalA));
    expect(selected?.reference).toBe(externalRef(externalA));
    expect(selected?.source.occurrenceId).toBe(externalA);
    expect(selected?.canonical).toBeNull();
    expect(selected?.scope).toBeNull();
    expect(await comparison.getPublicComparisonClaim(externalRef("missing"))).toBeNull();
    expect(await prisma.knowledgeNode.count()).toBe(0);
    expect(await prisma.nodeEdge.count()).toBe(0);
  });

  it("preserves identical text with distinct scope, occurrence and version on reopen", async () => {
    const pair = await comparison.getPublicClaimComparison(ref(leftVersion), ref(rightVersion));
    expect(pair).not.toBeNull();
    expect(pair!.left.text).toBe(pair!.right.text);
    expect(pair!.left.scope?.population).toBe("rodent");
    expect(pair!.right.scope?.population).toBe("human");
    expect(pair!.left.source.occurrenceId).not.toBe(pair!.right.source.occurrenceId);
    expect(pair!.left.source.versionId).not.toBe(pair!.right.source.versionId);
    const query = new URL(pair!.href, "https://oratlas.example").searchParams;
    expect(
      await comparison.getPublicClaimComparison(query.get("left")!, query.get("right")!),
    ).toEqual(pair);
    expect(pair!.sharedSourceFacts.filter((fact) => fact.includes("DOI"))).toHaveLength(1);
    expect(pair!.left.evidence).toHaveLength(2);
    expect(pair!.left.evidence.every((entry) => entry.status === "source-assertion")).toBe(true);
    expect(pair!.relationships).toEqual([]);
    expect(await prisma.nodeEdge.count()).toBe(0);
    expect(await prisma.nodeEdgeProposal.count()).toBe(0);
  });

  it("denies a withheld exact side and missing side without exposing either projection", async () => {
    expect(
      await comparison.getPublicClaimComparison(ref(leftVersion), ref(withheldVersion)),
    ).toBeNull();
    expect(await comparison.getPublicClaimComparison(ref("missing"), ref(rightVersion))).toBeNull();
    await prisma.reviewVersion.update({
      where: { id: withheldVersion },
      data: { publicState: "unknown-state" },
    });
    expect(
      await comparison.getPublicClaimComparison(ref(withheldVersion), ref(rightVersion)),
    ).toBeNull();
  });

  it("keeps withdrawn content readable with its lifecycle explicitly disclosed", async () => {
    await prisma.reviewVersion.update({
      where: { id: rightVersion },
      data: { publicState: "withdrawn" },
    });
    const pair = await comparison.getPublicClaimComparison(ref(leftVersion), ref(rightVersion));
    expect(pair?.right.source.lifecycle).toBe("withdrawn");
  });

  it("supports unmaterialized external occurrences without inventing canonical identity or scope", async () => {
    const pair = await comparison.getPublicClaimComparison(
      externalRef(externalA),
      externalRef(externalB),
    );
    expect(pair).not.toBeNull();
    expect(pair!.left.text).toBe(pair!.right.text);
    expect(pair!.left.source.versionId).not.toBe(pair!.right.source.versionId);
    expect(pair!.left.source.occurrenceId).not.toBe(pair!.right.source.occurrenceId);
    expect(pair!.left.canonical).toBeNull();
    expect(pair!.left.scope).toBeNull();
    expect(pair!.left.source.passage).toBe("Original passage");
    expect(pair!.left.source.structuralProvenance).toBe("published-structure");
    expect(pair!.left.source.href).toMatch(/^\/publications\/.+\/versions\//);
    expect(pair!.left.source.publishedTargetUrl).toBe("https://first.example/paper/#claim");
    expect(pair!.limitations.join(" ")).toContain("no canonical graph binding");
    expect(await prisma.knowledgeNode.count()).toBe(0);
  });

  it("fails closed for invalid external selectors and unsupported adapter records", async () => {
    const original = await prisma.publicationClaimOccurrence.findUniqueOrThrow({
      where: { id: externalA },
    });
    await prisma.publicationClaimOccurrence.update({
      where: { id: externalA },
      data: { selectorJson: "{}" },
    });
    expect(
      await comparison.getPublicClaimComparison(externalRef(externalA), externalRef(externalB)),
    ).toBeNull();
    await prisma.publicationClaimOccurrence.update({
      where: { id: externalA },
      data: { selectorJson: original.selectorJson },
    });
    await prisma.publicationVersion.update({
      where: { id: original.publicationVersionId },
      data: { adapterBindingJson: '{"type":"unknown","protocolVersion":"future"}' },
    });
    expect(
      await comparison.getPublicClaimComparison(externalRef(externalA), externalRef(externalB)),
    ).toBeNull();
    await prisma.publicationVersion.update({
      where: { id: original.publicationVersionId },
      data: {
        adapterBindingJson: JSON.stringify({
          type: "myst",
          protocolVersion: "0.2.0",
          crossReferenceInventoryPath: "xref.json",
          generatorName: "myst",
          generatorVersion: "1.0.0",
        }),
      },
    });
  });

  it("allows a preserved unmaterialized occurrence with no current external URL", async () => {
    const original = await prisma.publicationClaimOccurrence.findUniqueOrThrow({
      where: { id: externalA },
    });
    await prisma.publicationClaimOccurrence.update({
      where: { id: externalA },
      data: { publishedUrl: null },
    });
    const pair = await comparison.getPublicClaimComparison(
      externalRef(externalA),
      externalRef(externalB),
    );
    expect(pair?.left.source.publishedTargetUrl).toBeUndefined();
    expect(pair?.left.source.href).toMatch(/^\/publications\//);
    await prisma.publicationClaimOccurrence.update({
      where: { id: externalA },
      data: { publishedUrl: original.publishedUrl },
    });
  });

  it("binds canonical references to exact historical occurrences and leaves proposals unconfirmed", async () => {
    const { materializePublicationClaimOccurrence } = await import("@oratlas/db");
    const a = await prisma.$transaction((tx) =>
      materializePublicationClaimOccurrence(tx, externalA),
    );
    const b = await prisma.$transaction((tx) =>
      materializePublicationClaimOccurrence(tx, externalB),
    );
    expect(a.knowledgeNodeId).not.toBe(b.knowledgeNodeId);
    const proposal = await prisma.nodeEdgeProposal.create({
      data: {
        originKey: "comparison-proposal",
        sourceStableKey: "comparison-a",
        targetStableKey: "comparison-b",
        sourceNodeVersionId: a.knowledgeNodeVersionId,
        targetNodeId: b.knowledgeNodeId,
        targetNodeVersionId: b.knowledgeNodeVersionId,
        relationType: "contradicts",
        origin: "proposed-by-agent",
        rationale: "PRIVATE PROPOSAL RATIONALE",
      },
    });
    const aRef = `/nodes/${a.knowledgeNodeId}/versions/${a.knowledgeNodeVersionId}`;
    const bRef = `/nodes/${b.knowledgeNodeId}/versions/${b.knowledgeNodeVersionId}`;
    const externalContextInput = {
      nodeId: a.knowledgeNodeId,
      nodeVersionId: a.knowledgeNodeVersionId,
      occurrenceId: externalA,
      publicationVersionId: (
        await prisma.publicationClaimOccurrence.findUniqueOrThrow({ where: { id: externalA } })
      ).publicationVersionId,
    };
    expect(await sourceContext.getExternalOccurrencePageContext(externalContextInput)).toEqual({
      locator: "paper.md:L2-L3",
    });
    expect(
      await sourceContext.getExternalOccurrencePageContext({
        ...externalContextInput,
        nodeVersionId: b.knowledgeNodeVersionId,
      }),
    ).toBeNull();
    expect(
      await sourceContext.getExternalOccurrencePageContext({
        ...externalContextInput,
        occurrenceId: externalB,
      }),
    ).toBeNull();
    const pair = await comparison.getPublicClaimComparison(aRef, bRef);
    expect(await comparison.getPublicClaimComparison(aRef, externalRef(externalA))).toBeNull();
    expect((await comparison.getPublicComparisonClaim(aRef))?.source.occurrenceId).toBe(externalA);
    expect(
      await comparison.getPublicComparisonClaim(
        `/nodes/${a.knowledgeNodeId}/versions/${b.knowledgeNodeVersionId}`,
      ),
    ).toBeNull();
    expect(pair?.left.reference).toBe(aRef);
    expect(pair?.right.reference).toBe(bRef);
    expect(pair?.left.source.occurrenceId).toBe(externalA);
    expect(pair?.right.source.occurrenceId).toBe(externalB);
    expect(pair?.relationships).toEqual([]);
    expect(JSON.stringify(pair)).not.toContain("PRIVATE PROPOSAL RATIONALE");
    expect(
      (await prisma.nodeEdgeProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status,
    ).toBe("proposed");
    expect(await prisma.nodeEdge.count()).toBe(0);
    expect(
      await comparison.getPublicClaimComparison(
        `/nodes/${a.knowledgeNodeId}/versions/${b.knowledgeNodeVersionId}`,
        bRef,
      ),
    ).toBeNull();
    // An existing editorial relation is displayed separately from linked evidence.
    const editor = await prisma.user.create({
      data: { githubLogin: "comparison-editor", role: "EDITOR" },
    });
    const edge = await prisma.nodeEdge.create({
      data: {
        sourceNodeVersionId: a.knowledgeNodeVersionId,
        targetNodeId: b.knowledgeNodeId,
        confirmedTargetNodeVersionId: b.knowledgeNodeVersionId,
        relationType: "contradicts",
        status: "confirmed",
        provenance: "confirmed-by-editor",
        confirmedById: editor.id,
        confirmedAt: new Date(),
      },
    });
    const recorded = await comparison.getPublicClaimComparison(aRef, bRef);
    expect(recorded?.relationships.map((relation) => relation.id)).toEqual([edge.id]);
    expect(recorded?.left.evidence).toEqual([]);
    expect(recorded?.right.evidence).toEqual([]);
  });

  it("rejects mutable, external, malformed and mismatched canonical references", async () => {
    for (const reference of [
      "/nodes/claim",
      "https://example.test/claims/a/b",
      "/claims/a/b?latest=1",
      "/claims/a/%2f",
      "/claims/a/%zz",
      "/claims/a/b#section",
    ]) {
      expect(comparison.parseClaimComparisonReference(reference)).toBeNull();
      expect(await comparison.getPublicClaimComparison(reference, ref(rightVersion))).toBeNull();
    }
    expect(
      await comparison.getPublicClaimComparison("/nodes/absent/versions/wrong", ref(rightVersion)),
    ).toBeNull();
  });

  it("reports bounded evidence truncation and never collapses repeated source occurrences", async () => {
    const claim = await prisma.claim.findFirstOrThrow({ where: { reviewVersionId: leftVersion } });
    for (let index = 0; index < 25; index++) {
      const citation = await prisma.citation.create({
        data: {
          reviewVersionId: leftVersion,
          localCitationId: `overflow-${index}`,
          doi: "10.5555/repeated-source",
        },
      });
      await prisma.claimEvidenceRelation.create({
        data: { claimId: claim.id, citationId: citation.id, relationType: "supports" },
      });
    }
    const pair = await comparison.getPublicClaimComparison(ref(leftVersion), ref(rightVersion));
    expect(pair!.left.evidence).toHaveLength(25);
    expect(pair!.left.evidenceTruncated).toBe(true);
    expect(pair!.sharedSourceFacts.filter((fact) => fact.includes("DOI"))).toHaveLength(1);
  });

  it("allows two distinct occurrences within the same exact source version", async () => {
    const other = await prisma.claim.create({
      data: {
        reviewVersionId: leftVersion,
        localClaimId: "second-occurrence",
        text: "The intervention improves the outcome.",
        normalizedText: "the intervention improves the outcome.",
      },
    });
    const pair = await comparison.getPublicClaimComparison(
      ref(leftVersion),
      `/claims/${leftVersion}/${other.localClaimId}`,
    );
    expect(pair?.left.source.versionId).toBe(pair?.right.source.versionId);
    expect(pair?.left.source.occurrenceId).not.toBe(pair?.right.source.occurrenceId);
    expect(pair?.sharedSourceFacts).toContain(
      "Both occurrences belong to the same exact source version.",
    );
  });
});
