import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalJson, type PublicationType } from "@oratlas/contracts";
import {
  createHardenedRemoteFetcher,
  normalizeMystPublication,
  verifyExternalPublication,
  type RemoteFetcher,
  type VerifiedExternalPublication,
} from "@oratlas/publications";
import {
  applyDatabaseGuards,
  type PublicationClaimMaterializationReport,
  type PrismaClient,
} from "@oratlas/db";

vi.mock("server-only", () => ({}));

const databasePath = join(
  tmpdir(),
  `oratlas-external-registration-${process.pid}-${Date.now()}.db`,
);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}?connection_limit=1`;
const observedAt = "2026-08-24T08:00:00.000Z";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

let prisma: PrismaClient;
let persist: (
  verified: VerifiedExternalPublication,
  actorId: string,
) => Promise<{
  captureId: string;
  publicationId: string;
  publicationVersionId: string;
  replayed: boolean;
}>;
let editorId: string;

function verifiedFixture(
  sourcesSha256 = sha("document-set-v1"),
  publicationType: PublicationType = "other",
): VerifiedExternalPublication {
  const claim = {
    schemaVersion: "0.2.0",
    id: "claim-1",
    text: "A captured claim.",
    target: { type: "myst-xref", identifier: "claim-1", htmlId: "claim-1" },
    source: {
      documentPath: "results.md",
      documentSha256: sha("source"),
      startLine: 1,
      endLine: 1,
      blockSha256: sha("block"),
    },
    selector: {
      representation: "oratlas-myst-source-utf8-v1",
      unit: "body",
      textQuote: { type: "TextQuoteSelector", exact: "A captured claim." },
      textPosition: { type: "TextPositionSelector", start: 0, end: 17 },
    },
    declarationSha256: sha("declaration"),
  };
  const manifest = {
    schemaVersion: "0.2.0",
    generator: { name: "@oratlas/myst", version: "0.2.0" },
    publication: {
      id: "stable-publication",
      canonicalUrl: "https://example.org/review/",
      version: { sourcesSha256 },
    },
    adapter: { type: "myst", xref: "myst.xref.json" },
    artifacts: {
      claims: {
        path: "oratlas/claims.jsonl",
        format: "jsonl",
        records: 1,
        sha256: sha(`${JSON.stringify(claim)}\n`),
        declarations: "publication-source",
      },
    },
  };
  const normalized = normalizeMystPublication({
    manifest,
    claims: [claim],
    publicationType,
    structuralProvenance: "published-structure",
    observedAt,
    registrationKey: "registration-key",
    verificationWarnings: [],
  });
  const manifestBytes = Buffer.from(`\ufeff${JSON.stringify(manifest)}`);
  const pageBytes = Buffer.from('{"mdast":{"type":"root","children":[]}}');
  return {
    manifest: manifest as VerifiedExternalPublication["manifest"],
    normalized,
    artifacts: [
      {
        artifactKind: "publication-manifest",
        requestedUrl: "https://example.org/review/oratlas.manifest.json",
        observedUrl: "https://example.org/review/oratlas.manifest.json",
        mediaType: "application/json",
        bytes: manifestBytes,
        contentSha256: sha(manifestBytes.toString("utf8")),
        provenance: { status: 200, redirects: [], headers: { etag: '"fixture"' } },
      },
      ...["pages/one.json", "pages/two.json"].map((declaredPath) => ({
        artifactKind: "published-page-data" as const,
        declaredPath,
        requestedUrl: `https://example.org/review/${declaredPath}`,
        observedUrl: `https://example.org/review/${declaredPath}`,
        mediaType: "application/json",
        bytes: pageBytes,
        contentSha256: sha(pageBytes.toString("utf8")),
        provenance: { status: 200, redirects: [], headers: { etag: '"shared-bytes"' } },
      })),
    ],
    warnings: [],
    resolvedClaimUrls: new Map([["claim-1", "https://example.org/review/#claim-1"]]),
  };
}

function federationFixture(site: "a" | "b"): VerifiedExternalPublication {
  const origin = `https://site-${site}.example/publication/`;
  const claims = [1, 2].map((ordinal) => {
    const id = `claim-${site}${ordinal}`;
    const text =
      ordinal === 1
        ? site === "a"
          ? "The intervention improves the measured outcome."
          : "The intervention does not improve the measured outcome."
        : `Independent secondary claim from site ${site.toUpperCase()}.`;
    return {
      schemaVersion: "0.2.0" as const,
      id,
      text,
      target: { type: "myst-xref" as const, identifier: id, htmlId: `source-${id}` },
      source: {
        documentPath: "results.md",
        documentSha256: sha(`site-${site}-source`),
        startLine: ordinal,
        endLine: ordinal,
        blockSha256: sha(`site-${site}-block-${ordinal}`),
      },
      selector: {
        representation: "oratlas-myst-source-utf8-v1" as const,
        unit: "block" as const,
        textQuote: { type: "TextQuoteSelector" as const, exact: text },
        textPosition: {
          type: "TextPositionSelector" as const,
          start: 0,
          end: Array.from(text).length,
        },
      },
      declarationSha256: sha(
        canonicalJson({
          schemaVersion: "0.2.0",
          id,
          body: text,
          claimType: undefined,
          qualification: undefined,
        }),
      ),
    };
  });
  const claimsBytes = claims.map((claim) => JSON.stringify(claim)).join("\n") + "\n";
  const manifest = {
    schemaVersion: "0.2.0" as const,
    generator: { name: "@oratlas/myst", version: "0.2.0" },
    publication: {
      id: `publication-${site}`,
      ...(site === "a" ? { canonicalUrl: origin } : {}),
      version: { sourcesSha256: sha(`site-${site}-document-set`) },
    },
    adapter: { type: "myst" as const, xref: "myst.xref.json" },
    artifacts: {
      claims: {
        path: "oratlas/claims.jsonl",
        format: "jsonl" as const,
        records: 2,
        sha256: sha(claimsBytes),
        declarations: "publication-source" as const,
      },
    },
  };
  const normalized = normalizeMystPublication({
    manifest,
    claims,
    publicationType: "research-article",
    structuralProvenance: "published-structure",
    observedAt,
    registrationKey: `registration-${site}`,
    verificationWarnings: [],
  });
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  return {
    manifest,
    normalized,
    artifacts: [
      {
        artifactKind: "publication-manifest",
        requestedUrl: `${origin}oratlas.manifest.json`,
        observedUrl: `${origin}oratlas.manifest.json`,
        mediaType: "application/json",
        bytes: manifestBytes,
        contentSha256: sha(manifestBytes.toString("utf8")),
        provenance: { status: 200, redirects: [], headers: { etag: `"site-${site}"` } },
      },
      {
        artifactKind: "claim-stream",
        declaredPath: "oratlas/claims.jsonl",
        requestedUrl: `${origin}oratlas/claims.jsonl`,
        observedUrl: `${origin}oratlas/claims.jsonl`,
        mediaType: "application/x-ndjson",
        bytes: Buffer.from(claimsBytes),
        contentSha256: sha(claimsBytes),
        declaredSha256: sha(claimsBytes),
        provenance: { status: 200, redirects: [], headers: {} },
      },
    ],
    warnings: [],
    resolvedClaimUrls: new Map(
      claims.map((claim) => [claim.id, `${origin}results/#${claim.target.htmlId}`]),
    ),
  };
}

async function verifyFederationSite(site: "a" | "b"): Promise<VerifiedExternalPublication> {
  const fixture = federationFixture(site);
  const claims = fixture.normalized.occurrences.map((occurrence) => ({
    schemaVersion: "0.2.0",
    id: occurrence.sourceLocalClaimId,
    ...(occurrence.declaration.authority === "publication-source"
      ? {
          text: occurrence.declaration.text,
          claimType: occurrence.declaration.claimType,
          qualification: occurrence.declaration.qualification,
        }
      : {}),
    target: occurrence.target,
    source: occurrence.sourceBinding,
    selector: occurrence.selector,
    declarationSha256: occurrence.declarationSha256,
  }));
  const claimsBytes = `${claims.map((claim) => JSON.stringify(claim)).join("\n")}\n`;
  const manifest = structuredClone(fixture.manifest);
  manifest.artifacts.claims.sha256 = sha(claimsBytes);
  const xref = {
    references: claims.map((claim) => ({
      identifier: claim.id,
      url: "/results/",
      data: "content/results.json",
    })),
  };
  const page = {
    mdast: {
      type: "root",
      children: claims.map((claim) => ({
        type: "container",
        identifier: claim.id,
        html_id: claim.target.type === "myst-xref" ? claim.target.htmlId : claim.id,
        data: { oratlas: { kind: "claim", id: claim.id } },
      })),
    },
  };
  const files = new Map<string, readonly [string, string]>([
    ["/publication/oratlas.manifest.json", [JSON.stringify(manifest), "application/json"]],
    ["/publication/oratlas/claims.jsonl", [claimsBytes, "application/x-ndjson"]],
    ["/publication/myst.xref.json", [JSON.stringify(xref), "application/json"]],
    ["/publication/content/results.json", [JSON.stringify(page), "application/json"]],
  ]);
  const server = createServer((request, response) => {
    const file = files.get(request.url ?? "");
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("missing");
      return;
    }
    response.writeHead(200, { "content-type": file[1] });
    response.end(file[0]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const transport = createHardenedRemoteFetcher({
    allowHttpForTests: true,
    allowPrivateAddressesForTests: true,
    allowNonDefaultPortsForTests: true,
    resolver: async () => [{ address: "127.0.0.1", family: 4 }],
  });
  const fetcher: RemoteFetcher = {
    async fetch(url, request) {
      const transportUrl = new URL(url);
      transportUrl.protocol = "http:";
      const result = await transport.fetch(transportUrl.href, request);
      const observedHttps = (value: string) => {
        const observed = new URL(value);
        observed.protocol = "https:";
        return observed.href;
      };
      return {
        ...result,
        requestedUrl: observedHttps(result.requestedUrl),
        finalUrl: observedHttps(result.finalUrl),
        provenance: {
          ...result.provenance,
          redirects: result.provenance.redirects.map((redirect) => ({
            ...redirect,
            from: observedHttps(redirect.from),
            to: observedHttps(redirect.to),
          })),
        },
      };
    },
  };
  try {
    return await verifyExternalPublication({
      manifestUrl: `https://site-${site}.test:${port}/publication/oratlas.manifest.json`,
      publicationType: "research-article",
      registrationKey: `registration-${site}`,
      now: () => new Date(observedAt),
      fetcher,
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  execFileSync(
    process.execPath,
    [
      resolve(process.cwd(), "packages/db/node_modules/prisma/build/index.js"),
      "db",
      "push",
      "--schema",
      resolve(process.cwd(), "packages/db/prisma/schema.prisma"),
      "--skip-generate",
    ],
    { env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" }, stdio: "pipe" },
  );
  const database = await import("./db");
  prisma = database.prisma;
  await applyDatabaseGuards(prisma, "sqlite");
  const registration = await import("./external-publication-registration");
  persist = registration.persistVerifiedExternalPublication;
  const editor = await prisma.user.create({
    data: {
      githubUserId: "external-registration-editor",
      githubLogin: "external-editor",
      role: "EDITOR",
    },
  });
  editorId = editor.id;
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

describe("external publication registration persistence", () => {
  it("is replay-idempotent and creates a new immutable version when sources change", async () => {
    const first = await persist(verifiedFixture(), editorId);
    expect(first.replayed).toBe(false);
    const replay = await persist(verifiedFixture(), editorId);
    expect(replay.replayed).toBe(true);
    expect(replay.captureId).toBe(first.captureId);
    expect(replay.publicationVersionId).toBe(first.publicationVersionId);

    const conflicting = verifiedFixture();
    const conflictingBytes = Buffer.from('{"mdast":{"type":"root","changed":true}}');
    conflicting.artifacts[1] = {
      ...conflicting.artifacts[1]!,
      bytes: conflictingBytes,
      contentSha256: sha(conflictingBytes.toString("utf8")),
    };
    await expect(persist(conflicting, editorId)).rejects.toThrow(/immutable capture/);

    const changed = await persist(verifiedFixture(sha("document-set-v2")), editorId);
    expect(changed.replayed).toBe(false);
    expect(changed.publicationId).toBe(first.publicationId);
    expect(changed.publicationVersionId).not.toBe(first.publicationVersionId);

    expect(await prisma.publication.count()).toBe(1);
    expect(await prisma.publicationVersion.count()).toBe(2);
    expect(await prisma.publicationCapture.count()).toBe(6);
    expect(await prisma.publicationClaimOccurrence.count()).toBe(2);
    const equalByteCaptures = await prisma.publicationCapture.findMany({
      where: {
        publicationVersionId: first.publicationVersionId,
        artifactKind: "published-page-data",
      },
      orderBy: { declaredPath: "asc" },
    });
    expect(equalByteCaptures).toHaveLength(2);
    expect(equalByteCaptures.map(({ declaredPath }) => declaredPath)).toEqual([
      "pages/one.json",
      "pages/two.json",
    ]);
    expect(equalByteCaptures.map(({ requestedUrl }) => requestedUrl)).toEqual([
      "https://example.org/review/pages/one.json",
      "https://example.org/review/pages/two.json",
    ]);
    expect(
      equalByteCaptures.map(({ httpProvenanceJson }) => JSON.parse(httpProvenanceJson)),
    ).toEqual([
      { headers: { etag: '"shared-bytes"' }, redirects: [], status: 200 },
      { headers: { etag: '"shared-bytes"' }, redirects: [], status: 200 },
    ]);
    expect(new Set(equalByteCaptures.map(({ contentSha256 }) => contentSha256)).size).toBe(1);
    expect(
      new Set(equalByteCaptures.map(({ artifactIdentitySha256 }) => artifactIdentitySha256)).size,
    ).toBe(2);
    const capture = await prisma.publicationCapture.findUniqueOrThrow({
      where: { id: first.captureId },
    });
    expect(capture.requestedUrl).toBe("https://example.org/review/oratlas.manifest.json");
    expect(capture.observedUrl).toBe(capture.requestedUrl);
    expect(capture.contentBytes?.startsWith("\ufeff")).toBe(true);
    expect(capture.contentSha256).toBe(sha(capture.contentBytes!));
    expect(JSON.parse(capture.httpProvenanceJson)).toMatchObject({ status: 200 });
    expect(JSON.parse(canonicalJson(JSON.parse(capture.httpProvenanceJson)))).toMatchObject({
      status: 200,
    });
  });

  it("persists optional adapter-normalized production assertions without a MyST branch", async () => {
    const verified = verifiedFixture(sha("document-set-with-production"));
    verified.normalized.productionAssertions = [
      {
        sourceAssertionKey: "declared-production-v1",
        mode: "agentic",
        actors: [
          {
            kind: "workflow",
            name: "Declared research workflow",
            version: "1.0.0",
          },
        ],
        activities: ["evidence-search", "drafting"],
        statement: "The publication source declares an agentic authoring workflow.",
        strength: "source-declared",
        publicEvidenceUrl: "https://example.org/review/production.json",
      },
    ];
    const created = await persist(verified, editorId);
    expect(created.replayed).toBe(false);
    expect(await persist(verified, editorId)).toMatchObject({
      publicationVersionId: created.publicationVersionId,
      replayed: true,
    });
    expect(
      await prisma.publicationProductionAssertion.findMany({
        where: { publicationVersionId: created.publicationVersionId },
        select: {
          sourceAssertionKey: true,
          mode: true,
          strength: true,
          assertedById: true,
        },
      }),
    ).toEqual([
      {
        sourceAssertionKey: "declared-production-v1",
        mode: "agentic",
        strength: "source-declared",
        assertedById: null,
      },
    ]);
  });

  it("federates two independent sites through the one canonical graph", async () => {
    const verifiedA = await verifyFederationSite("a");
    const verifiedB = await verifyFederationSite("b");
    expect(verifiedB.manifest.publication.canonicalUrl).toBeUndefined();
    expect(verifiedB.warnings).toContain(
      "The manifest declares no canonicalUrl; published links use the observed manifest root.",
    );
    const exactB1Url = verifiedB.resolvedClaimUrls.get("claim-b1")!;
    const observedBBase = new URL(
      ".",
      verifiedB.artifacts.find((artifact) => artifact.artifactKind === "publication-manifest")!
        .observedUrl!,
    ).href;
    expect(verifiedA.artifacts.map((artifact) => artifact.artifactKind)).toEqual([
      "publication-manifest",
      "claim-stream",
      "cross-reference-inventory",
      "published-page-data",
    ]);
    expect(verifiedB.artifacts.map((artifact) => artifact.artifactKind)).toEqual([
      "publication-manifest",
      "claim-stream",
      "cross-reference-inventory",
      "published-page-data",
    ]);
    const siteA = await persist(verifiedA, editorId);
    const siteB = await persist(verifiedB, editorId);
    expect(siteA.publicationId).not.toBe(siteB.publicationId);
    expect(
      await prisma.publicationVersion.findUniqueOrThrow({
        where: { id: siteB.publicationVersionId },
        select: { canonicalUrl: true, observedPublicationBaseUrl: true },
      }),
    ).toEqual({ canonicalUrl: null, observedPublicationBaseUrl: observedBBase });
    expect((await persist(verifiedA, editorId)).replayed).toBe(true);
    expect((await persist(verifiedB, editorId)).replayed).toBe(true);

    const occurrences = await prisma.publicationClaimOccurrence.findMany({
      where: {
        publicationVersionId: { in: [siteA.publicationVersionId, siteB.publicationVersionId] },
      },
      orderBy: { sourceLocalClaimId: "asc" },
    });
    expect(occurrences).toHaveLength(4);
    const materializationService = await import("./external-publication-materialization");
    const reports: PublicationClaimMaterializationReport[] = [];
    for (const occurrence of occurrences) {
      reports.push(
        await materializationService.materializeExternalPublicationClaim(occurrence.id, editorId),
      );
    }
    expect(new Set(reports.map((report) => report.knowledgeNodeId)).size).toBe(4);

    const byLocalId = new Map(
      occurrences.map(
        (occurrence, index) => [occurrence.sourceLocalClaimId, reports[index]!] as const,
      ),
    );
    const b1 = byLocalId.get("claim-b1")!;
    const a1 = byLocalId.get("claim-a1")!;
    const [bNode, aNode] = await Promise.all([
      prisma.knowledgeNode.findUniqueOrThrow({ where: { id: b1.knowledgeNodeId } }),
      prisma.knowledgeNode.findUniqueOrThrow({ where: { id: a1.knowledgeNodeId } }),
    ]);
    const sourceStableKey = canonicalJson({
      knowledgeNodeStableKey: bNode.stableKey,
      sourcePublicationClaimOccurrenceId: b1.publicationClaimOccurrenceId,
    });
    const targetStableKey = canonicalJson({
      knowledgeNodeStableKey: aNode.stableKey,
      sourcePublicationClaimOccurrenceId: a1.publicationClaimOccurrenceId,
    });
    const candidate = {
      sourceStableKey,
      targetStableKey,
      relationType: "contradicts",
      rationale: "The independently published primary conclusions conflict.",
      evidence: { sites: ["a", "b"] },
    };
    const run = await prisma.agentRun.create({
      data: {
        agentType: "node-edge-proposal",
        status: "succeeded",
        outputJson: canonicalJson({
          candidate,
          candidateHash: sha(canonicalJson(candidate)),
        }),
      },
    });
    const lifecycle = await import("./node-edge-lifecycle");
    const proposal = await lifecycle.createAgentNodeEdgeProposal({
      agentRunId: run.id,
      sourceNodeVersionId: b1.knowledgeNodeVersionId,
      targetNodeVersionId: a1.knowledgeNodeVersionId,
      relationType: "contradicts",
      rationale: candidate.rationale,
      evidence: candidate.evidence,
    });
    const decision = await lifecycle.decideNodeEdgeProposal(
      { id: editorId, role: "EDITOR" },
      proposal.proposalId,
      { decision: "confirm", expectedRevision: 0, note: "Confirmed across independent sites." },
    );
    expect(decision.status).toBe("confirmed");

    const graphService = await import("./canonical-graph-query");
    const graph = await graphService.queryCanonicalGraph({
      seed: b1.knowledgeNodeId,
      version: b1.knowledgeNodeVersionId,
      direction: "both",
      status: "confirmed",
      limit: 100,
    });
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.relationType).toBe("contradicts");
    expect(graph.nodes.every((node) => node.source.type === "publication-claim-occurrence")).toBe(
      true,
    );
    expect(
      graph.nodes.map((node) =>
        node.source.type === "publication-claim-occurrence" ? node.source.publishedTargetUrl : null,
      ),
    ).toEqual(
      expect.arrayContaining([
        "https://site-a.example/publication/results/#source-claim-a1",
        exactB1Url,
      ]),
    );
    const graphB1 = graph.nodes.find(
      (node) =>
        node.source.type === "publication-claim-occurrence" &&
        node.source.sourceLocalClaimId === "claim-b1",
    );
    expect(graphB1?.source).toMatchObject({
      publisherCanonicalUrl: null,
      observedPublicationBaseUrl: observedBBase,
      publishedTargetUrl: exactB1Url,
    });

    const packetService = await import("./publication-version-packet");
    const packet = await packetService.getPublicationVersionPacket(siteB.publicationVersionId);
    const replayedPacket = await packetService.getPublicationVersionPacket(
      siteB.publicationVersionId,
    );
    expect(replayedPacket).toEqual(packet);
    expect(packet.version).toMatchObject({
      publisherCanonicalUrl: null,
      observedPublicationBaseUrl: observedBBase,
    });
    expect(packet.occurrences).toHaveLength(2);
    expect(
      packet.occurrences.find((occurrence) => occurrence.sourceLocalClaimId === "claim-b1"),
    ).toMatchObject({ publishedTargetUrl: exactB1Url, links: { originalPublication: exactB1Url } });
    expect(packet.relations).toHaveLength(1);
    expect(packet.completeness.occurrences).toEqual({ returned: 2, total: 2, truncated: false });
    expect(JSON.stringify(packet)).not.toContain("contentBytes");
    expect(JSON.stringify(packet)).not.toContain(claimsRawBytes(verifiedB));
  });
});

function claimsRawBytes(fixture: VerifiedExternalPublication): string {
  return new TextDecoder().decode(
    fixture.artifacts.find((artifact) => artifact.artifactKind === "claim-stream")!.bytes,
  );
}
