import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PUBLICATION_BOUNDARY_SCHEMA_VERSION,
  publicationClaimOccurrenceRecordSchema,
  publicationRecordSchema,
  type PublicationProductionActor,
} from "@oratlas/contracts";
import {
  publicationClaimOccurrenceStableKey,
  publicationStableKey,
  publicationVersionStableKey,
} from "./identity.js";
import {
  mystPublicationAdapter,
  type MystClaimRecord,
  type MystPublicationManifest,
} from "./adapters/myst.js";
import {
  publicationArtifactIdentitySha256,
  type CapturedPublicationArtifact,
  type NormalizedPublication,
  type PublicationAdapter,
} from "./adapter.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function mystInput(id: string) {
  const source = "A format adapter transports structure, not author identity.";
  const manifest: MystPublicationManifest = {
    schemaVersion: "0.2.0",
    generator: { name: "@oratlas/myst", version: "0.2.0" },
    publication: { id, version: { sourcesSha256: digest(`${id}:sources`) } },
    adapter: { type: "myst", xref: "myst.xref.json" },
    artifacts: {
      claims: {
        path: "oratlas/claims.jsonl",
        format: "jsonl",
        records: 1,
        sha256: digest(`${id}:claims`),
        declarations: "publication-source",
      },
    },
  };
  const claim: MystClaimRecord = {
    schemaVersion: "0.2.0",
    id: "result-1",
    text: source,
    target: { type: "myst-xref", identifier: "result-1", htmlId: "result-1" },
    source: {
      documentPath: "results.md",
      documentSha256: digest(`${id}:document`),
      startLine: 1,
      endLine: 1,
      blockSha256: digest(`${id}:block`),
    },
    selector: {
      representation: "oratlas-myst-source-utf8-v1",
      unit: "body",
      textQuote: { type: "TextQuoteSelector", exact: source },
      textPosition: { type: "TextPositionSelector", start: 0, end: source.length },
    },
    declarationSha256: digest(`${id}:declaration`),
  };
  return { manifest, claims: [claim] };
}

interface SyntheticManifest {
  schemaVersion: "test-1";
  publicationId: string;
  sourcesSha256: string;
}

type SyntheticNormalized = NormalizedPublication<
  { type: "synthetic-format"; protocolVersion: "test-1" },
  { type: "published-anchor"; identifier: string; fragment: string }
>;

const syntheticAdapter: PublicationAdapter<
  SyntheticManifest,
  { captured: boolean },
  { targetPresent: boolean },
  { manifest: SyntheticManifest; text: string },
  { baseUrl: string; fragment: string },
  SyntheticNormalized
> = {
  type: "synthetic-format",
  supportedProtocolVersions: ["test-1"],
  recognizeManifest(value) {
    return (value as { schemaVersion?: unknown })?.schemaVersion === "test-1";
  },
  validateManifest(value) {
    return value as SyntheticManifest;
  },
  describeRequiredArtifacts() {
    return [{ artifactKind: "claim-stream", declaredPath: "claims.test", required: true }];
  },
  validateCapturedArtifacts(input) {
    if (!input.captured) throw new Error("missing capture");
  },
  verifyPublishedStructure(input) {
    if (!input.targetPresent) throw new Error("missing target");
  },
  normalize({ manifest, text }, context) {
    const evidence = { basis: "registration" as const, registrationKey: manifest.publicationId };
    const publicationKey = publicationStableKey(evidence);
    const versionKey = publicationVersionStableKey(publicationKey, manifest.sourcesSha256);
    const publication = publicationRecordSchema.parse({
      schemaVersion: PUBLICATION_BOUNDARY_SCHEMA_VERSION,
      stableKey: publicationKey,
      publicationType: context.publicationType,
      recordSource: "external-publication",
      identityEvidence: evidence,
      sourceLocalPublicationId: manifest.publicationId,
    });
    const occurrence = publicationClaimOccurrenceRecordSchema.parse({
      schemaVersion: PUBLICATION_BOUNDARY_SCHEMA_VERSION,
      stableKey: publicationClaimOccurrenceStableKey(versionKey, "result-1"),
      publicationVersionStableKey: versionKey,
      sourceLocalClaimId: "result-1",
      target: { type: "published-anchor", identifier: "result-1", fragment: "result-1" },
      sourceBinding: {
        documentPath: "article.test",
        documentSha256: digest("synthetic-document"),
        startLine: 1,
        endLine: 1,
        blockSha256: digest("synthetic-block"),
      },
      selector: {
        representation: "oratlas-source-utf8-v1",
        unit: "body",
        textQuote: { type: "TextQuoteSelector", exact: text },
        textPosition: { type: "TextPositionSelector", start: 0, end: text.length },
      },
      declarationSha256: digest("synthetic-declaration"),
      declaration: { authority: "publication-source", text },
    }) as SyntheticNormalized["occurrences"][number];
    return {
      publication,
      version: {
        schemaVersion: PUBLICATION_BOUNDARY_SCHEMA_VERSION,
        stableKey: versionKey,
        publicationStableKey: publicationKey,
        sourceLocalPublicationId: manifest.publicationId,
        sourcesSha256: manifest.sourcesSha256,
        adapter: { type: "synthetic-format", protocolVersion: "test-1" },
        structuralProvenance: context.structuralProvenance,
        verificationWarnings: [],
        observedAt: context.observedAt,
      },
      occurrences: [occurrence],
    };
  },
  normalizeContent(artifacts, context) {
    const captured = artifacts[0]!;
    const text = new TextDecoder().decode(captured.bytes);
    return {
      documents: [
        {
          id: `synthetic-content:${digest(context.publicationVersionStableKey)}`,
          title: "Synthetic methods",
          role: "methods",
          sourcePath: captured.declaredPath ?? null,
          publishedUrl: null,
          representation: "source-text",
          text,
          sha256: digest(text),
          sourceArtifactIdentitySha256: publicationArtifactIdentitySha256(captured),
          sourceArtifactSha256: captured.contentSha256,
        },
      ],
      completeness: {
        returnedDocuments: 1,
        totalDocumentsKnown: 1,
        truncated: false,
        coverage: "complete",
      },
    };
  },
  resolvePublishedTarget({ baseUrl, fragment }) {
    return new URL(`#${fragment}`, baseUrl).href;
  },
};

describe("generic publication adapter boundary", () => {
  it("uses the exact same frozen MyST adapter for human and ARS production histories", () => {
    const humanInput = mystInput("human-paper");
    expect(mystPublicationAdapter.supportedProtocolVersions).toEqual(["0.2.0"]);
    expect(mystPublicationAdapter.recognizeManifest(humanInput.manifest)).toBe(true);
    expect(mystPublicationAdapter.describeRequiredArtifacts(humanInput.manifest)).toHaveLength(2);
    mystPublicationAdapter.validateCapturedArtifacts({
      manifest: humanInput.manifest,
      artifacts: [
        {
          artifactKind: "claim-stream",
          declaredPath: "oratlas/claims.jsonl",
          mediaType: "application/jsonl",
          bytes: new Uint8Array(),
          contentSha256: humanInput.manifest.artifacts.claims.sha256,
        },
        {
          artifactKind: "cross-reference-inventory",
          declaredPath: "myst.xref.json",
          mediaType: "application/json",
          bytes: new Uint8Array(),
          contentSha256: digest("xref"),
        },
      ],
    });
    mystPublicationAdapter.verifyPublishedStructure({
      claims: humanInput.claims,
      verifiedClaimIds: new Set(["result-1"]),
    });
    const human = mystPublicationAdapter.normalize(humanInput, {
      publicationType: "research-article",
      structuralProvenance: "published-structure",
      observedAt: "2026-08-24T00:00:00.000Z",
      registrationKey: "human-paper",
    });
    const ars = mystPublicationAdapter.normalize(mystInput("ars-paper"), {
      publicationType: "research-article",
      structuralProvenance: "published-structure",
      observedAt: "2026-08-24T00:00:00.000Z",
      registrationKey: "ars-paper",
    });
    expect(human.version.adapter.type).toBe("myst");
    expect(ars.version.adapter).toMatchObject({ type: "myst", protocolVersion: "0.2.0" });
    expect(human.productionAssertions).toBeUndefined();
    expect(ars.productionAssertions).toBeUndefined();
  });

  it("lets a test-only second format normalize through the same generic records", () => {
    const manifest: SyntheticManifest = {
      schemaVersion: "test-1",
      publicationId: "portable-paper",
      sourcesSha256: digest("portable-v2"),
    };
    expect(syntheticAdapter.recognizeManifest(manifest)).toBe(true);
    expect(syntheticAdapter.describeRequiredArtifacts(manifest)).toHaveLength(1);
    syntheticAdapter.validateCapturedArtifacts({ captured: true });
    syntheticAdapter.verifyPublishedStructure({ targetPresent: true });
    const normalized = syntheticAdapter.normalize(
      { manifest, text: "The second format reaches the generic occurrence boundary." },
      {
        publicationType: "research-article",
        structuralProvenance: "published-structure",
        observedAt: "2026-08-24T01:00:00.000Z",
      },
    );
    expect(normalized.version.adapter.type).toBe("synthetic-format");
    expect(normalized.occurrences[0]?.target.type).toBe("published-anchor");
    expect(
      syntheticAdapter.resolvePublishedTarget({
        baseUrl: "https://format.example/article/",
        fragment: "result-1",
      }),
    ).toBe("https://format.example/article/#result-1");
    const bytes = Buffer.from("Synthetic adapter methods text.");
    const captured: CapturedPublicationArtifact = {
      artifactKind: "source-document",
      declaredPath: "article.test",
      mediaType: "text/plain",
      bytes,
      contentSha256: digest(bytes.toString()),
    };
    const content = syntheticAdapter.normalizeContent?.([captured], {
      publicationVersionStableKey: normalized.version.stableKey,
      publicationBaseUrl: "https://format.example/article/",
      limits: {
        maxDocuments: 10,
        maxBytesPerDocument: 10_000,
        maxTotalBytes: 10_000,
        maxTextLength: 10_000,
        maxNodesPerDocument: 1_000,
      },
    });
    expect(content?.documents[0]).toMatchObject({
      role: "methods",
      representation: "source-text",
      text: "Synthetic adapter methods text.",
    });
    expect(content?.completeness.coverage).toBe("complete");
  });

  it("keeps content support optional instead of fabricating a corpus", () => {
    const { normalizeContent: _unsupported, ...withoutContent } = syntheticAdapter;
    expect(withoutContent).not.toHaveProperty("normalizeContent");
  });

  it("keeps AI/software production actors out of scholarly contributor semantics", () => {
    const actor: PublicationProductionActor = {
      kind: "ai-system",
      name: "ARS research agent",
      provider: "Example Lab",
      model: "research-model",
    };
    expect(actor.kind).toBe("ai-system");
    expect(actor).not.toHaveProperty("author");
    expect(actor).not.toHaveProperty("orcid");
  });
});

export { syntheticAdapter };
