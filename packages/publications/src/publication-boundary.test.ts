import { describe, expect, it } from "vitest";
import {
  MYST_CLAIM_RECORD_PROTOCOL_VERSION,
  MYST_LEGACY_PUBLICATION_PROTOCOL_VERSION,
  PUBLICATION_TYPES,
  type PublicationSourceDescriptor,
} from "@oratlas/contracts";
import {
  PublicationAdapterError,
  PublicationIdentityError,
  derivePublicationIdentityEvidence,
  mystClaimRecordSchema,
  mystPublicationManifestSchema,
  normalizeMystPublication,
  projectReviewAsPublication,
  publicationClaimOccurrenceStableKey,
  publicationStableKey,
  publicationTypeForReviewType,
  publicationVersionStableKey,
  reachedStructuralProvenance,
} from "./index.js";

const digest = (seed: string) => seed.repeat(64).slice(0, 64);

const CLAIM_QUOTE = "Adolescent stress alters HPA reactivity.";
const CLAIM_QUOTE_START = 217;
const CLAIM_QUOTE_END = CLAIM_QUOTE_START + Array.from(CLAIM_QUOTE).length;

const SOURCES_V1 = digest("1");
const SOURCES_V2 = digest("2");

function claimRecord(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: MYST_CLAIM_RECORD_PROTOCOL_VERSION,
    id: "hpa-axis-mediation",
    text: "Adolescent stress alters HPA reactivity [@mccormick2010].",
    claimType: "mechanistic",
    target: {
      type: "myst-xref",
      identifier: "hpa-axis-mediation",
      htmlId: "hpa-axis-mediation",
    },
    source: {
      documentPath: "results.md",
      documentSha256: digest("a"),
      startLine: 12,
      endLine: 23,
      blockSha256: digest("b"),
    },
    selector: {
      representation: "oratlas-myst-source-utf8-v1",
      unit: "body",
      textQuote: { type: "TextQuoteSelector", exact: CLAIM_QUOTE },
      textPosition: {
        type: "TextPositionSelector",
        start: CLAIM_QUOTE_START,
        end: CLAIM_QUOTE_END,
      },
    },
    declarationSha256: digest("c"),
    ...overrides,
  };
}

function manifest(overrides: Record<string, unknown> = {}) {
  const publication = {
    id: "adolescent-stress-review",
    canonicalUrl: "https://example.org/adolescent-stress/",
    title: "Adolescent stress and persistent behavioural change",
    version: { sourcesSha256: SOURCES_V1, label: "v1.0.0" },
    source: { type: "git", repository: "https://github.com/lab/review" },
    ...((overrides.publication as Record<string, unknown>) ?? {}),
  };
  return {
    schemaVersion: MYST_LEGACY_PUBLICATION_PROTOCOL_VERSION,
    generator: { name: "@oratlas/myst", version: "0.2.0" },
    publication,
    adapter: { type: "myst", xref: "myst.xref.json" },
    artifacts: {
      claims: {
        path: "oratlas/claims.jsonl",
        format: "jsonl",
        records: 1,
        sha256: digest("d"),
        declarations: "publication-source",
      },
      ...((overrides.artifacts as Record<string, unknown>) ?? {}),
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== "publication" && key !== "artifacts"),
    ),
  };
}

function normalize(overrides: Record<string, unknown> = {}, claims = [claimRecord()]) {
  return normalizeMystPublication({
    manifest: manifest(overrides),
    claims,
    publicationType: "research-article",
    structuralProvenance: "published-structure",
    observedAt: "2026-08-23T00:00:00.000Z",
  });
}

describe("generic publication types", () => {
  it("normalizes an external publication under any supported publication type", () => {
    for (const publicationType of PUBLICATION_TYPES) {
      const result = normalizeMystPublication({
        manifest: manifest(),
        claims: [claimRecord()],
        publicationType,
        structuralProvenance: "published-structure",
        observedAt: "2026-08-23T00:00:00.000Z",
      });
      expect(result.publication.publicationType).toBe(publicationType);
      expect(result.publication.recordSource).toBe("external-publication");
    }
  });

  it("projects a legacy review into the review-article publication type", () => {
    const projected = projectReviewAsPublication({
      reviewId: "review-1",
      reviewType: "systematic-review",
    });
    expect(projected.publicationType).toBe("review-article");
    expect(projected.recordSource).toBe("atlas-review-projection");
    expect(projected.reviewId).toBe("review-1");
    expect(projected.stableKey).toBe("publication:review:v1:review-1");
  });

  it("maps every review type without defaulting an unrelated kind to review-article", () => {
    expect(publicationTypeForReviewType(null)).toBe("review-article");
    expect(publicationTypeForReviewType("ai-synthesis")).toBe("review-article");
    expect(publicationTypeForReviewType("meta-analysis")).toBe("review-article");
    expect(publicationTypeForReviewType("data-release")).toBe("other");
    expect(publicationTypeForReviewType("other")).toBe("other");
  });

  it("keeps a projected review distinct from an external publication of the same subject", () => {
    const projected = projectReviewAsPublication({ reviewId: "review-1", reviewType: null });
    const external = normalize().publication;
    expect(projected.stableKey).not.toBe(external.stableKey);
  });
});

describe("publication stable identity versus version identity", () => {
  it("keys the publication from durable evidence and the version from the source digest", () => {
    const result = normalize();
    expect(result.publication.stableKey).toMatch(/^publication:external:v1:[0-9a-f]{64}$/);
    expect(result.version.stableKey).toMatch(/^publication-version:v1:[0-9a-f]{64}$/);
    expect(result.version.publicationStableKey).toBe(result.publication.stableKey);
    expect(result.version.sourcesSha256).toBe(SOURCES_V1);
  });

  it("never uses a URL alone as identity", () => {
    expect(() =>
      derivePublicationIdentityEvidence({ canonicalUrl: "https://example.org/review/" }),
    ).toThrow(PublicationIdentityError);
    expect(() => derivePublicationIdentityEvidence({})).toThrow(PublicationIdentityError);

    // The same publication served from a second host keeps one identity when a
    // durable source is declared.
    const mirrored = normalize({
      publication: { canonicalUrl: "https://mirror.example.net/adolescent-stress/" },
    });
    expect(mirrored.publication.stableKey).toBe(normalize().publication.stableKey);
  });

  it("does not treat a version DOI or an archive digest as publication identity", () => {
    const versionOnly: PublicationSourceDescriptor = {
      type: "doi",
      versionDoi: "10.5281/zenodo.1234567",
    };
    expect(() => derivePublicationIdentityEvidence({ source: versionOnly })).toThrow(
      PublicationIdentityError,
    );
    const archive: PublicationSourceDescriptor = {
      type: "archive",
      url: "https://example.org/source.tar.gz",
      sha256: digest("e"),
    };
    expect(() => derivePublicationIdentityEvidence({ source: archive })).toThrow(
      PublicationIdentityError,
    );
    expect(
      derivePublicationIdentityEvidence({
        source: {
          type: "doi",
          versionDoi: "10.5281/zenodo.1234567",
          conceptDoi: "10.5281/zenodo.1234566",
        },
      }),
    ).toEqual({ basis: "concept-doi", conceptDoi: "10.5281/zenodo.1234566" });
  });

  it("keeps two versions of one publication under one publication identity", () => {
    const first = normalize();
    const second = normalize({ publication: { version: { sourcesSha256: SOURCES_V2 } } });
    expect(second.publication.stableKey).toBe(first.publication.stableKey);
    expect(second.version.stableKey).not.toBe(first.version.stableKey);
    expect(second.version.sourcesSha256).toBe(SOURCES_V2);
  });

  it("lets distinct publications carry an identical sourcesSha256", () => {
    const left = normalize();
    const right = normalize({
      publication: {
        id: "other-review",
        source: { type: "git", repository: "https://github.com/other-lab/review" },
      },
    });
    expect(right.version.sourcesSha256).toBe(left.version.sourcesSha256);
    expect(right.publication.stableKey).not.toBe(left.publication.stableKey);
    expect(right.version.stableKey).not.toBe(left.version.stableKey);
  });

  it("rejects a source digest that is not an exact lowercase hex digest", () => {
    expect(() => publicationVersionStableKey("publication:external:v1:x", "NOT-A-DIGEST")).toThrow(
      PublicationIdentityError,
    );
  });
});

describe("source occurrence identity", () => {
  it("scopes a claim occurrence key to its exact publication version", () => {
    const versionKey = publicationVersionStableKey(
      publicationStableKey({ basis: "registration", registrationKey: "reg-1" }),
      SOURCES_V1,
    );
    const otherVersionKey = publicationVersionStableKey(
      publicationStableKey({ basis: "registration", registrationKey: "reg-1" }),
      SOURCES_V2,
    );
    expect(publicationClaimOccurrenceStableKey(versionKey, "claim-a")).not.toBe(
      publicationClaimOccurrenceStableKey(otherVersionKey, "claim-a"),
    );
  });

  it("rejects a duplicated source-local claim id inside one publication version", () => {
    expect(() =>
      normalize(
        {
          artifacts: {
            claims: {
              path: "oratlas/claims.jsonl",
              format: "jsonl",
              records: 2,
              sha256: digest("d"),
              declarations: "publication-source",
            },
          },
        },
        [claimRecord(), claimRecord({ declarationSha256: digest("f") })],
      ),
    ).toThrow(PublicationAdapterError);
  });

  it("allows the same source-local claim id in two different publication versions", () => {
    const first = normalize();
    const second = normalize({ publication: { version: { sourcesSha256: SOURCES_V2 } } });
    expect(second.occurrences[0]!.sourceLocalClaimId).toBe(
      first.occurrences[0]!.sourceLocalClaimId,
    );
    expect(second.occurrences[0]!.stableKey).not.toBe(first.occurrences[0]!.stableKey);
  });

  it("never merges occurrences that share text, local id or declaration digest", () => {
    const first = normalize();
    const second = normalize({ publication: { version: { sourcesSha256: SOURCES_V2 } } });
    const left = first.occurrences[0]!;
    const right = second.occurrences[0]!;
    expect(right.declarationSha256).toBe(left.declarationSha256);
    expect(right.declaration).toEqual(left.declaration);
    expect(right.stableKey).not.toBe(left.stableKey);
    // A source occurrence carries no canonical binding at all.
    expect(Object.keys(left)).not.toContain("knowledgeNodeId");
    expect(Object.keys(left)).not.toContain("canonicalClaimId");
  });

  it("preserves adapter-specific target metadata without leaking it into generic fields", () => {
    const occurrence = normalize().occurrences[0]!;
    expect(occurrence.target).toEqual({
      type: "myst-xref",
      identifier: "hpa-axis-mediation",
      htmlId: "hpa-axis-mediation",
    });
    expect(occurrence.sourceLocalClaimId).toBe(occurrence.target.identifier);
    expect(Object.keys(occurrence)).not.toContain("mystXrefId");
    expect(Object.keys(occurrence)).not.toContain("mystHtmlId");
  });
});

describe("structural provenance levels", () => {
  const publishedStructure = {
    artifactDigestsMatched: true,
    declaredRecordCountsMatched: true,
    declaredPathsRevalidated: true,
    targetsResolvedInInventory: true,
  };
  const sourceBytes = {
    sourceDigestsMatched: true,
    declarationDigestsRecomputed: true,
    sourceSelectorsLocated: true,
  };

  it("reaches published-structure from the published site alone", () => {
    expect(reachedStructuralProvenance(publishedStructure)).toBe("published-structure");
  });

  it("reaches source-byte only when every source check passes", () => {
    expect(reachedStructuralProvenance({ ...publishedStructure, sourceBytes })).toBe("source-byte");
    expect(
      reachedStructuralProvenance({
        ...publishedStructure,
        sourceBytes: { ...sourceBytes, sourceSelectorsLocated: false },
      }),
    ).toBe("published-structure");
  });

  it("fails closed when the published structure does not verify", () => {
    expect(
      reachedStructuralProvenance({ ...publishedStructure, artifactDigestsMatched: false }),
    ).toBeNull();
    expect(
      reachedStructuralProvenance({
        ...publishedStructure,
        targetsResolvedInInventory: false,
        sourceBytes,
      }),
    ).toBeNull();
  });

  it("refuses source-byte provenance for a publication with no obtainable source", () => {
    expect(() =>
      normalizeMystPublication({
        manifest: manifest({ publication: { source: undefined } }),
        claims: [claimRecord()],
        publicationType: "preprint",
        structuralProvenance: "source-byte",
        observedAt: "2026-08-23T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("the pinned 0.2.0 adapter contract", () => {
  it("rejects an unimplemented schema version, adapter or target", () => {
    expect(
      mystPublicationManifestSchema.safeParse({ ...manifest(), schemaVersion: "0.4.0" }).success,
    ).toBe(false);
    expect(
      mystPublicationManifestSchema.safeParse({
        ...manifest(),
        adapter: { type: "quarto", xref: "quarto.xref.json" },
      }).success,
    ).toBe(false);
    expect(
      mystClaimRecordSchema.safeParse(
        claimRecord({ target: { type: "jats-id", identifier: "hpa-axis-mediation" } }),
      ).success,
    ).toBe(false);
  });

  it("rejects an unknown key on either closed object", () => {
    expect(
      mystPublicationManifestSchema.safeParse({ ...manifest(), trustScore: 0.9 }).success,
    ).toBe(false);
    expect(mystClaimRecordSchema.safeParse(claimRecord({ trustScore: 0.9 })).success).toBe(false);
  });

  it("rejects an unsafe declared path", () => {
    expect(
      mystPublicationManifestSchema.safeParse({
        ...manifest(),
        adapter: { type: "myst", xref: "../myst.xref.json" },
      }).success,
    ).toBe(false);
  });

  it("rejects a declared record count that disagrees with the artifact", () => {
    expect(() => normalize({}, [])).toThrow(PublicationAdapterError);
  });

  it("honours the declared claim-declaration authority in both directions", () => {
    const reviewManifestArtifacts = {
      claims: {
        path: "oratlas/claims.jsonl",
        format: "jsonl",
        records: 1,
        sha256: digest("d"),
        declarations: "review-manifest",
      },
    };
    expect(() => normalize({ artifacts: reviewManifestArtifacts })).toThrow(
      PublicationAdapterError,
    );
    const bound = normalize(
      { artifacts: reviewManifestArtifacts, oratlas: { reviewManifest: "review-manifest.json" } },
      [claimRecord({ text: undefined, claimType: undefined })],
    );
    expect(bound.occurrences[0]!.declaration).toEqual({ authority: "review-manifest" });
    expect(() =>
      normalize({ artifacts: reviewManifestArtifacts }, [
        claimRecord({ text: undefined, claimType: undefined }),
      ]),
    ).toThrow(PublicationAdapterError);
  });

  it("rejects records that are not in the protocol's deterministic order", () => {
    const artifacts = {
      claims: {
        path: "oratlas/claims.jsonl",
        format: "jsonl",
        records: 2,
        sha256: digest("d"),
        declarations: "publication-source",
      },
    };
    const later = claimRecord({
      id: "second-claim",
      target: { type: "myst-xref", identifier: "second-claim", htmlId: "second-claim" },
      source: {
        documentPath: "results.md",
        documentSha256: digest("a"),
        startLine: 40,
        endLine: 44,
        blockSha256: digest("9"),
      },
      declarationSha256: digest("8"),
    });
    expect(normalize({ artifacts }, [claimRecord(), later]).occurrences).toHaveLength(2);
    expect(() => normalize({ artifacts }, [later, claimRecord()])).toThrow(PublicationAdapterError);
  });

  it("carries the pinned protocol version into the stored adapter binding", () => {
    const { version } = normalize();
    expect(version.adapter).toEqual({
      type: "myst",
      protocolVersion: "0.2.0",
      crossReferenceInventoryPath: "myst.xref.json",
      generatorName: "@oratlas/myst",
      generatorVersion: "0.2.0",
    });
  });
});
