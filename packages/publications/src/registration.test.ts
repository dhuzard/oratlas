import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson } from "@oratlas/contracts";
import { publicationArtifactIdentitySha256 } from "./adapter.js";
import { createHardenedRemoteFetcher } from "./remote-fetch.js";
import {
  PublicationSourceUnavailableError,
  resolveMystPublishedUrl,
  verifyExternalPublication,
  type PublicationSourceResolver,
} from "./registration.js";

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

const source = "A source-backed claim";
const claimBase = {
  schemaVersion: "0.2.0",
  id: "claim-1",
  text: source,
  claimType: "empirical",
  target: { type: "myst-xref", identifier: "claim-1", htmlId: "claim-1" },
  source: {
    documentPath: "results.md",
    documentSha256: digest(source),
    startLine: 1,
    endLine: 1,
    blockSha256: digest(source),
  },
  selector: {
    representation: "oratlas-myst-source-utf8-v1",
    unit: "body",
    textQuote: { type: "TextQuoteSelector", exact: source },
    textPosition: { type: "TextPositionSelector", start: 0, end: Array.from(source).length },
  },
  declarationSha256: digest(
    canonicalJson({
      schemaVersion: "0.2.0",
      id: "claim-1",
      body: source,
      claimType: "empirical",
      qualification: undefined,
    }),
  ),
};

let files = new Map<string, { body: string; type: string }>();
let server: Server;
let port: number;

interface MutableFixtureManifest {
  unknown?: boolean;
  adapter: { xref: string };
  artifacts: { claims: { path: string } };
}

function resetFixture(
  options: {
    claim?: Record<string, unknown>;
    manifest?: Record<string, unknown>;
    xref?: unknown;
    page?: unknown;
    sourceDescriptor?: unknown;
  } = {},
) {
  const claim = options.claim ?? claimBase;
  const claims = `${JSON.stringify(claim)}\n`;
  const manifest =
    options.manifest ??
    ({
      schemaVersion: "0.2.0",
      generator: { name: "@oratlas/myst", version: "0.2.0" },
      publication: {
        id: "fixture-publication",
        canonicalUrl: "https://example.org/journal/review/",
        version: { sourcesSha256: digest("document-set-v1") },
        ...(options.sourceDescriptor === undefined ? {} : { source: options.sourceDescriptor }),
      },
      adapter: { type: "myst", xref: "myst.xref.json" },
      artifacts: {
        claims: {
          path: "oratlas/claims.jsonl",
          format: "jsonl",
          records: 1,
          sha256: digest(claims),
          declarations: "publication-source",
        },
      },
    } as Record<string, unknown>);
  const xref =
    options.xref ??
    ({
      references: [{ identifier: "claim-1", url: "/results", data: "content/results.json" }],
    } as const);
  const page =
    options.page ??
    ({
      mdast: {
        type: "root",
        children: [
          {
            type: "container",
            identifier: "claim-1",
            html_id: "claim-1",
            data: { oratlas: { kind: "claim", id: "claim-1" } },
          },
          {
            type: "heading",
            depth: 1,
            children: [{ type: "text", value: "Results" }],
          },
          {
            type: "paragraph",
            children: [{ type: "text", value: "The primary scientific result is reported here." }],
          },
        ],
      },
    } as const);
  files = new Map([
    ["/review/oratlas.manifest.json", { body: JSON.stringify(manifest), type: "application/json" }],
    ["/review/oratlas/claims.jsonl", { body: claims, type: "application/x-ndjson" }],
    ["/review/myst.xref.json", { body: JSON.stringify(xref), type: "application/json" }],
    ["/review/content/results.json", { body: JSON.stringify(page), type: "application/json" }],
  ]);
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const file = files.get(request.url ?? "");
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("missing");
      return;
    }
    response.writeHead(200, { "content-type": file.type });
    response.end(file.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => resetFixture());

function fetcher() {
  return createHardenedRemoteFetcher({
    allowHttpForTests: true,
    allowPrivateAddressesForTests: true,
    allowNonDefaultPortsForTests: true,
    resolver: async () => [{ address: "127.0.0.1", family: 4 }],
  });
}

function verify(sourceResolver?: PublicationSourceResolver) {
  return verifyExternalPublication({
    manifestUrl: `http://fixture.test:${port}/review/oratlas.manifest.json`,
    publicationType: "other",
    registrationKey: "fixture-registration",
    fetcher: fetcher(),
    sourceResolver,
  });
}

describe("external publication registration verification", () => {
  it("reaches published-structure using only deployed bytes and captures each exact artifact", async () => {
    const result = await verify();
    expect(result.normalized.version.structuralProvenance).toBe("published-structure");
    expect(result.normalized.occurrences).toHaveLength(1);
    expect(result.artifacts.map((artifact) => artifact.artifactKind)).toEqual([
      "publication-manifest",
      "claim-stream",
      "cross-reference-inventory",
      "published-page-data",
    ]);
    expect(result.resolvedClaimUrls.get("claim-1")).toBe(
      "https://example.org/journal/review/results#claim-1",
    );
    expect(result.normalized.content?.documents).toHaveLength(1);
    expect(result.normalized.content?.documents[0]).toMatchObject({
      role: "results",
      sourcePath: "content/results.json",
      representation: "published-structured-text",
      publishedUrl: "https://example.org/journal/review/results",
    });
    expect(result.normalized.content?.documents[0]?.text).toContain("primary scientific result");
    expect(result.normalized.content?.completeness).toEqual({
      returnedDocuments: 1,
      totalDocumentsKnown: 1,
      truncated: false,
      coverage: "partial",
    });
  });

  it("verifies a 0.3 manifest with frozen 0.2 claims, contributors, production, and content", async () => {
    const manifest = JSON.parse(files.get("/review/oratlas.manifest.json")!.body);
    manifest.schemaVersion = "0.3.0";
    manifest.generator = { name: "@neuronautix/myst", version: "0.3.0" };
    manifest.contributors = [
      {
        sourceContributorKey: "alice",
        kind: "person",
        displayName: "Alice Example",
        identifiers: [{ scheme: "orcid", value: "0000-0002-1825-0097" }],
        roles: ["author"],
        position: 1,
      },
    ];
    manifest.production = {
      sourceAssertionKey: "publication-production",
      strength: "source-declared",
      mode: "hybrid",
      actors: [
        {
          id: "workflow",
          kind: "workflow",
          name: "ARS workflow",
          activities: ["evidence-search", "drafting"],
        },
        {
          id: "alice-editor",
          kind: "person",
          name: "Alice Example",
          activities: ["drafting", "editing"],
        },
      ],
    };
    files.set("/review/oratlas.manifest.json", {
      body: JSON.stringify(manifest),
      type: "application/json",
    });
    files.set("/review/myst.xref.json", {
      body: JSON.stringify({
        version: "1",
        myst: "1.10.1",
        references: [
          { kind: "page", data: "/content/results.json", url: "/results" },
          {
            identifier: "claim-1",
            kind: "div",
            data: "/content/results.json",
            url: "/results",
          },
        ],
      }),
      type: "application/json",
    });

    const result = await verify();
    const manifestArtifact = result.artifacts.find(
      (artifact) => artifact.artifactKind === "publication-manifest",
    )!;
    expect(result.manifest.schemaVersion).toBe("0.3.0");
    expect(result.normalized.version.adapter.protocolVersion).toBe("0.3.0");
    expect(result.normalized.occurrences).toHaveLength(1);
    expect(result.normalized.content?.documents).toHaveLength(1);
    expect(result.normalized.contributors?.[0]).toMatchObject({
      sourceContributorKey: "alice",
      displayName: "Alice Example",
      sourceDeclarationProvenance: {
        type: "source-declared",
        sourceArtifactKind: "publication-manifest",
        sourceArtifactIdentitySha256: publicationArtifactIdentitySha256(manifestArtifact),
        sourceArtifactSha256: manifestArtifact.contentSha256,
      },
    });
    expect(result.normalized.productionAssertions?.[0]).toMatchObject({
      mode: "hybrid",
      activities: ["evidence-search", "drafting", "editing"],
      actors: [
        { kind: "workflow", name: "ARS workflow" },
        { kind: "person", name: "Alice Example" },
      ],
    });
  });

  it("captures a bounded inventory-derived corpus and reports truncation honestly", async () => {
    resetFixture({
      xref: {
        references: [
          { identifier: "claim-1", url: "/results", data: "content/results.json" },
          { identifier: "introduction", url: "/introduction", data: "content/introduction.json" },
        ],
      },
    });
    files.set("/review/content/introduction.json", {
      type: "application/json",
      body: JSON.stringify({
        mdast: {
          type: "root",
          children: [
            {
              type: "heading",
              depth: 1,
              children: [{ type: "text", value: "Introduction" }],
            },
            {
              type: "paragraph",
              children: [{ type: "text", value: "This study addresses an important gap." }],
            },
          ],
        },
      }),
    });
    const completeInventoryCapture = await verify();
    expect(completeInventoryCapture.normalized.content?.documents).toHaveLength(2);
    expect(completeInventoryCapture.normalized.content?.completeness).toMatchObject({
      totalDocumentsKnown: 2,
      truncated: false,
      coverage: "partial",
    });

    const bounded = await verifyExternalPublication({
      manifestUrl: `http://fixture.test:${port}/review/oratlas.manifest.json`,
      publicationType: "other",
      registrationKey: "fixture-registration",
      fetcher: fetcher(),
      limits: { maxContentDocuments: 1 },
    });
    expect(bounded.normalized.content?.documents).toHaveLength(1);
    expect(bounded.normalized.content?.completeness).toEqual({
      returnedDocuments: 1,
      totalDocumentsKnown: 2,
      truncated: true,
      coverage: "partial",
    });
  });

  it("omits a malformed optional content page without weakening claim verification", async () => {
    resetFixture({
      xref: {
        references: [
          { identifier: "claim-1", url: "/results", data: "content/results.json" },
          { identifier: "appendix", url: "/appendix", data: "content/appendix.json" },
        ],
      },
    });
    files.set("/review/content/appendix.json", {
      type: "application/json",
      body: "{not-json}",
    });
    const result = await verify();
    expect(result.normalized.occurrences).toHaveLength(1);
    expect(result.normalized.content?.documents).toHaveLength(1);
    expect(result.normalized.content?.completeness).toMatchObject({
      totalDocumentsKnown: 2,
      truncated: true,
      coverage: "partial",
    });
    expect(result.warnings).toContain(
      "Content coverage is partial: optional published page 'content/appendix.json' was not a bounded valid structured document.",
    );
  });

  it("uses the normative subpath deployment resolution rule", () => {
    expect(resolveMystPublishedUrl("https://host.example/subpath/", "/results", "claim-1")).toBe(
      "https://host.example/subpath/results#claim-1",
    );
  });

  it.each([
    ["invalid JSON", "not-json", "invalid-artifact"],
    ["unsupported schema", JSON.stringify({ schemaVersion: "0.4.0" }), "unsupported-protocol"],
  ])("rejects %s fail-closed", async (_label, body, code) => {
    files.set("/review/oratlas.manifest.json", { body, type: "application/json" });
    await expect(verify()).rejects.toMatchObject({ code });
  });

  it("rejects unknown manifest keys and unsafe/traversing artifact paths", async () => {
    for (const mutation of [
      (manifest: MutableFixtureManifest) => (manifest.unknown = true),
      (manifest: MutableFixtureManifest) => (manifest.adapter.xref = "../myst.xref.json"),
      (manifest: MutableFixtureManifest) =>
        (manifest.artifacts.claims.path = "https://evil.example/claims"),
    ]) {
      resetFixture();
      const manifest = JSON.parse(
        files.get("/review/oratlas.manifest.json")!.body,
      ) as MutableFixtureManifest;
      mutation(manifest);
      files.set("/review/oratlas.manifest.json", {
        body: JSON.stringify(manifest),
        type: "application/json",
      });
      await expect(verify()).rejects.toMatchObject({ code: "invalid-manifest" });
    }
  });

  it("rejects hash mismatch, record-count mismatch, malformed JSONL, and duplicate ids", async () => {
    let manifest = JSON.parse(files.get("/review/oratlas.manifest.json")!.body);
    manifest.artifacts.claims.sha256 = digest("wrong");
    files.set("/review/oratlas.manifest.json", {
      body: JSON.stringify(manifest),
      type: "application/json",
    });
    await expect(verify()).rejects.toMatchObject({ code: "integrity-mismatch" });

    resetFixture();
    manifest = JSON.parse(files.get("/review/oratlas.manifest.json")!.body);
    manifest.artifacts.claims.records = 2;
    files.set("/review/oratlas.manifest.json", {
      body: JSON.stringify(manifest),
      type: "application/json",
    });
    await expect(verify()).rejects.toMatchObject({ code: "integrity-mismatch" });

    resetFixture();
    files.set("/review/oratlas/claims.jsonl", { body: "{bad}\n", type: "application/x-ndjson" });
    manifest = JSON.parse(files.get("/review/oratlas.manifest.json")!.body);
    manifest.artifacts.claims.sha256 = digest("{bad}\n");
    files.set("/review/oratlas.manifest.json", {
      body: JSON.stringify(manifest),
      type: "application/json",
    });
    await expect(verify()).rejects.toMatchObject({ code: "invalid-artifact" });

    resetFixture();
    const claims = `${JSON.stringify(claimBase)}\n${JSON.stringify(claimBase)}\n`;
    manifest = JSON.parse(files.get("/review/oratlas.manifest.json")!.body);
    manifest.artifacts.claims.records = 2;
    manifest.artifacts.claims.sha256 = digest(claims);
    files.set("/review/oratlas.manifest.json", {
      body: JSON.stringify(manifest),
      type: "application/json",
    });
    files.set("/review/oratlas/claims.jsonl", { body: claims, type: "application/x-ndjson" });
    await expect(verify()).rejects.toMatchObject({ code: "invalid-artifact" });
  });

  it("rejects a missing xref target and a missing published claim node", async () => {
    resetFixture({ xref: { references: [] } });
    await expect(verify()).rejects.toMatchObject({ code: "missing-target" });
    resetFixture({ page: { mdast: { type: "root", children: [] } } });
    await expect(verify()).rejects.toMatchObject({ code: "missing-target" });
  });

  it("validates all claims sharing a page from one bounded structural index", async () => {
    const claims = Array.from({ length: 250 }, (_, index) => {
      const id = `claim-${index.toString().padStart(3, "0")}`;
      const text = `${source} ${index}`;
      return {
        ...claimBase,
        id,
        text,
        target: { type: "myst-xref", identifier: id, htmlId: id },
        selector: {
          ...claimBase.selector,
          textQuote: { type: "TextQuoteSelector", exact: text },
          textPosition: { type: "TextPositionSelector", start: 0, end: Array.from(text).length },
        },
        declarationSha256: digest(
          canonicalJson({
            schemaVersion: "0.2.0",
            id,
            body: text,
            claimType: "empirical",
            qualification: undefined,
          }),
        ),
      };
    });
    const claimsJsonl = `${claims.map((claim) => JSON.stringify(claim)).join("\n")}\n`;
    const manifest = JSON.parse(files.get("/review/oratlas.manifest.json")!.body);
    manifest.artifacts.claims.records = claims.length;
    manifest.artifacts.claims.sha256 = digest(claimsJsonl);
    files.set("/review/oratlas.manifest.json", {
      body: JSON.stringify(manifest),
      type: "application/json",
    });
    files.set("/review/oratlas/claims.jsonl", {
      body: claimsJsonl,
      type: "application/x-ndjson",
    });
    files.set("/review/myst.xref.json", {
      body: JSON.stringify({
        references: claims.map(({ id }) => ({
          identifier: id,
          url: "/results",
          data: "content/results.json",
        })),
      }),
      type: "application/json",
    });
    files.set("/review/content/results.json", {
      body: JSON.stringify({
        mdast: {
          type: "root",
          children: claims.map(({ id }) => ({
            type: "container",
            identifier: id,
            html_id: id,
            data: { oratlas: { kind: "claim", id } },
          })),
        },
      }),
      type: "application/json",
    });

    const result = await verify();
    expect(result.normalized.occurrences).toHaveLength(claims.length);
  });

  it("distinguishes changed versions and makes replay identity deterministic", async () => {
    const first = await verify();
    const replay = await verify();
    expect(replay.normalized.publication.stableKey).toBe(first.normalized.publication.stableKey);
    expect(replay.normalized.version.stableKey).toBe(first.normalized.version.stableKey);

    const manifest = JSON.parse(files.get("/review/oratlas.manifest.json")!.body);
    manifest.publication.version.sourcesSha256 = digest("document-set-v2");
    files.set("/review/oratlas.manifest.json", {
      body: JSON.stringify(manifest),
      type: "application/json",
    });
    const changed = await verify();
    expect(changed.normalized.publication.stableKey).toBe(first.normalized.publication.stableKey);
    expect(changed.normalized.version.stableKey).not.toBe(first.normalized.version.stableKey);
  });

  it("reaches source-byte only when exact immutable source is fully checked", async () => {
    resetFixture({
      sourceDescriptor: {
        type: "git",
        repository: "https://github.com/lab/review",
        commit: "0123456789abcdef0123456789abcdef01234567",
      },
    });
    const resolver: PublicationSourceResolver = {
      async resolve() {
        return [{ path: "results.md", bytes: Buffer.from(source), mediaType: "text/markdown" }];
      },
    };
    expect((await verify(resolver)).normalized.version.structuralProvenance).toBe("source-byte");
  });

  it("does not let optional content pages displace source-byte captures", async () => {
    resetFixture({
      sourceDescriptor: {
        type: "git",
        repository: "https://github.com/lab/review",
        commit: "0123456789abcdef0123456789abcdef01234567",
      },
      xref: {
        references: [
          { identifier: "claim-1", url: "/results", data: "content/results.json" },
          { identifier: "appendix", url: "/appendix", data: "content/appendix.json" },
        ],
      },
    });
    files.set("/review/content/appendix.json", {
      type: "application/json",
      body: JSON.stringify({
        mdast: {
          type: "root",
          children: [{ type: "paragraph", children: [{ type: "text", value: "Appendix" }] }],
        },
      }),
    });
    const resolver: PublicationSourceResolver = {
      async resolve() {
        return [{ path: "results.md", bytes: Buffer.from(source), mediaType: "text/markdown" }];
      },
    };
    const result = await verifyExternalPublication({
      manifestUrl: `http://fixture.test:${port}/review/oratlas.manifest.json`,
      publicationType: "other",
      registrationKey: "fixture-registration",
      fetcher: fetcher(),
      sourceResolver: resolver,
      limits: { maxArtifacts: 5 },
    });
    expect(result.normalized.version.structuralProvenance).toBe("source-byte");
    expect(result.normalized.content?.documents).toHaveLength(1);
    expect(result.normalized.content?.completeness.truncated).toBe(true);
    expect(result.artifacts.map((artifact) => artifact.artifactKind)).toContain("source-document");
  });

  it("records why an unavailable source does not masquerade as source-byte", async () => {
    resetFixture({
      sourceDescriptor: {
        type: "git",
        repository: "https://github.com/lab/review",
        commit: "0123456789abcdef0123456789abcdef01234567",
      },
    });
    const resolver: PublicationSourceResolver = {
      async resolve() {
        throw new PublicationSourceUnavailableError("the immutable source is unavailable.");
      },
    };
    const result = await verify(resolver);
    expect(result.normalized.version.structuralProvenance).toBe("published-structure");
    expect(result.warnings.join(" ")).toContain("immutable source is unavailable");
  });

  it("honours a delegated review-manifest stream as the sole declaration authority", async () => {
    const bindingOnly = { ...claimBase } as Record<string, unknown>;
    delete bindingOnly.text;
    delete bindingOnly.claimType;
    resetFixture({ claim: bindingOnly });
    const manifest = JSON.parse(files.get("/review/oratlas.manifest.json")!.body);
    manifest.artifacts.claims.declarations = "review-manifest";
    manifest.oratlas = { reviewManifest: "review-manifest.json" };
    files.set("/review/oratlas.manifest.json", {
      body: JSON.stringify(manifest),
      type: "application/json",
    });
    files.set("/review/review-manifest.json", {
      type: "application/json",
      body: JSON.stringify({
        schemaVersion: "1.0.0",
        review: { title: "Delegated fixture" },
        repository: { url: "https://github.com/lab/review" },
        artifacts: { claims: "knowledge/claims.jsonl" },
      }),
    });
    files.set("/review/knowledge/claims.jsonl", {
      type: "application/x-ndjson",
      body: `${JSON.stringify({ id: "claim-1", text: "Authoritative review claim.", claimType: "empirical" })}\n`,
    });
    const result = await verify();
    expect(result.normalized.occurrences[0]!.declaration).toEqual({
      authority: "review-manifest",
    });
    expect(result.delegatedDeclarations?.get("claim-1")?.text).toBe("Authoritative review claim.");
    expect(result.artifacts.map((artifact) => artifact.artifactKind)).toContain(
      "review-claim-stream",
    );
  });
});
