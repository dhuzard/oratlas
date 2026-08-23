import { describe, expect, it } from "vitest";
import {
  MYST_PUBLICATION_PROTOCOL_VERSION,
  PUBLICATION_BOUNDARY_SCHEMA_VERSION,
  PUBLICATION_STRUCTURAL_PROVENANCE_LEVELS,
  PUBLICATION_TYPES,
  describePublicationStructuralProvenance,
  publicationAdapterBindingSchema,
  publicationClaimDeclarationSchema,
  publicationClaimOccurrenceRecordSchema,
  publicationClaimSelectorSchema,
  publicationClaimSourceBindingSchema,
  publicationClaimTargetSchema,
  publicationIdentityEvidenceSchema,
  publicationRecordSchema,
  publicationSourceDescriptorSchema,
  publicationStructuralProvenanceSatisfies,
  publicationVersionRecordSchema,
} from "./publications.js";

const digest = (fill: string) => fill.repeat(64).slice(0, 64);

const selector = {
  representation: "oratlas-myst-source-utf8-v1" as const,
  unit: "body" as const,
  textQuote: { type: "TextQuoteSelector" as const, exact: "Adolescent stress persists." },
  textPosition: { type: "TextPositionSelector" as const, start: 10, end: 37 },
};

const sourceBinding = {
  documentPath: "results.md",
  documentSha256: digest("a"),
  startLine: 12,
  endLine: 23,
  blockSha256: digest("b"),
};

function occurrence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: PUBLICATION_BOUNDARY_SCHEMA_VERSION,
    stableKey: "publication-claim-occurrence:v1:1",
    publicationVersionStableKey: "publication-version:v1:1",
    sourceLocalClaimId: "hpa-axis-mediation",
    target: {
      type: "myst-xref" as const,
      identifier: "hpa-axis-mediation",
      htmlId: "hpa-axis-mediation",
    },
    sourceBinding,
    selector,
    declarationSha256: digest("c"),
    declaration: { authority: "publication-source" as const, text: "Adolescent stress persists." },
    ...overrides,
  };
}

describe("publication type vocabulary", () => {
  it("keeps review-article one publication type among several", () => {
    expect(PUBLICATION_TYPES).toContain("review-article");
    expect(PUBLICATION_TYPES).toContain("research-article");
    expect(PUBLICATION_TYPES).toContain("methods-article");
    expect(PUBLICATION_TYPES).toContain("preprint");
    expect(PUBLICATION_TYPES).toContain("living-review");
    expect(PUBLICATION_TYPES).toContain("other");
    expect(new Set(PUBLICATION_TYPES).size).toBe(PUBLICATION_TYPES.length);
  });

  it("rejects an unknown publication type rather than passing it through", () => {
    const parsed = publicationRecordSchema.safeParse({
      schemaVersion: PUBLICATION_BOUNDARY_SCHEMA_VERSION,
      stableKey: "publication:external:v1:1",
      publicationType: "blog-post",
      recordSource: "external-publication",
      identityEvidence: { basis: "concept-doi", conceptDoi: "10.5281/zenodo.1234566" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("structural provenance vocabulary", () => {
  it("defines exactly the two structural levels", () => {
    expect([...PUBLICATION_STRUCTURAL_PROVENANCE_LEVELS]).toEqual([
      "published-structure",
      "source-byte",
    ]);
  });

  it("never describes a level as scientifically verified, trustworthy, confirmed or peer reviewed", () => {
    for (const level of PUBLICATION_STRUCTURAL_PROVENANCE_LEVELS) {
      const wording = describePublicationStructuralProvenance(level).toLowerCase();
      expect(wording).not.toMatch(/scientifically verified|trustworthy|confirmed|peer.reviewed/);
    }
  });

  it("treats source-byte as subsuming published-structure and nothing more", () => {
    expect(publicationStructuralProvenanceSatisfies("source-byte", "published-structure")).toBe(
      true,
    );
    expect(publicationStructuralProvenanceSatisfies("source-byte", "source-byte")).toBe(true);
    expect(publicationStructuralProvenanceSatisfies("published-structure", "source-byte")).toBe(
      false,
    );
  });

  it("refuses source-byte provenance when no source descriptor was declared", () => {
    const base = {
      schemaVersion: PUBLICATION_BOUNDARY_SCHEMA_VERSION,
      stableKey: "publication-version:v1:1",
      publicationStableKey: "publication:external:v1:1",
      sourcesSha256: digest("d"),
      adapter: {
        type: "myst" as const,
        protocolVersion: MYST_PUBLICATION_PROTOCOL_VERSION,
        crossReferenceInventoryPath: "myst.xref.json",
        generatorName: "@oratlas/myst",
        generatorVersion: "0.2.0",
      },
      observedAt: "2026-08-23T00:00:00.000Z",
    };
    expect(
      publicationVersionRecordSchema.safeParse({
        ...base,
        structuralProvenance: "published-structure",
      }).success,
    ).toBe(true);
    expect(
      publicationVersionRecordSchema.safeParse({ ...base, structuralProvenance: "source-byte" })
        .success,
    ).toBe(false);
    expect(
      publicationVersionRecordSchema.safeParse({
        ...base,
        structuralProvenance: "source-byte",
        source: { type: "git", repository: "https://github.com/lab/review" },
      }).success,
    ).toBe(true);
  });
});

describe("publication identity evidence", () => {
  it("offers no basis that is a canonical URL alone", () => {
    const bases = publicationIdentityEvidenceSchema.options.map(
      (option) => option.shape.basis.value,
    );
    expect(bases).toEqual([
      "git-source",
      "concept-doi",
      "declared-identifier",
      "registration",
      "atlas-review",
    ]);
    expect(
      publicationIdentityEvidenceSchema.safeParse({
        basis: "declared-identifier",
        canonicalUrlOrigin: "https://lab.org",
      }).success,
    ).toBe(false);
  });

  it("binds review projections to review evidence in both directions", () => {
    const projection = {
      schemaVersion: PUBLICATION_BOUNDARY_SCHEMA_VERSION,
      stableKey: "publication:review:v1:review-1",
      publicationType: "review-article" as const,
      recordSource: "atlas-review-projection" as const,
      identityEvidence: { basis: "atlas-review" as const, reviewId: "review-1" },
      reviewId: "review-1",
    };
    expect(publicationRecordSchema.safeParse(projection).success).toBe(true);
    expect(
      publicationRecordSchema.safeParse({ ...projection, recordSource: "external-publication" })
        .success,
    ).toBe(false);
    expect(publicationRecordSchema.safeParse({ ...projection, reviewId: undefined }).success).toBe(
      false,
    );
  });
});

describe("closed, versioned adapter and target metadata", () => {
  it("pins the adapter protocol version and rejects unknown adapters and keys", () => {
    const binding = {
      type: "myst" as const,
      protocolVersion: MYST_PUBLICATION_PROTOCOL_VERSION,
      crossReferenceInventoryPath: "myst.xref.json",
      generatorName: "@oratlas/myst",
      generatorVersion: "0.2.0",
    };
    expect(publicationAdapterBindingSchema.safeParse(binding).success).toBe(true);
    expect(
      publicationAdapterBindingSchema.safeParse({ ...binding, protocolVersion: "0.3.0" }).success,
    ).toBe(false);
    expect(publicationAdapterBindingSchema.safeParse({ ...binding, type: "quarto" }).success).toBe(
      false,
    );
    expect(publicationAdapterBindingSchema.safeParse({ ...binding, mystXrefId: "x" }).success).toBe(
      false,
    );
  });

  it("rejects an unsafe declared inventory path", () => {
    for (const path of ["./myst.xref.json", "../myst.xref.json", "/myst.xref.json"]) {
      expect(
        publicationAdapterBindingSchema.safeParse({
          type: "myst",
          protocolVersion: MYST_PUBLICATION_PROTOCOL_VERSION,
          crossReferenceInventoryPath: path,
          generatorName: "@oratlas/myst",
          generatorVersion: "0.2.0",
        }).success,
      ).toBe(false);
    }
  });

  it("requires a generic identifier on every target variant", () => {
    for (const option of publicationClaimTargetSchema.options) {
      expect(Object.keys(option.shape)).toContain("identifier");
    }
    expect(
      publicationClaimTargetSchema.safeParse({ type: "jats-id", identifier: "a" }).success,
    ).toBe(false);
  });

  it("keeps version and concept DOI distinct in the source descriptor", () => {
    const parsed = publicationSourceDescriptorSchema.parse({
      type: "doi",
      versionDoi: "10.5281/zenodo.1234567",
      conceptDoi: "10.5281/zenodo.1234566",
    });
    expect(parsed).toEqual({
      type: "doi",
      versionDoi: "10.5281/zenodo.1234567",
      conceptDoi: "10.5281/zenodo.1234566",
    });
    expect(publicationSourceDescriptorSchema.safeParse({ type: "doi" }).success).toBe(false);
  });
});

describe("claim occurrence records", () => {
  it("accepts a well-formed publication-source occurrence", () => {
    expect(publicationClaimOccurrenceRecordSchema.safeParse(occurrence()).success).toBe(true);
  });

  it("requires the target identifier to equal the source-local claim id", () => {
    expect(
      publicationClaimOccurrenceRecordSchema.safeParse(
        occurrence({
          target: { type: "myst-xref", identifier: "another-claim", htmlId: "another-claim" },
        }),
      ).success,
    ).toBe(false);
  });

  it("keeps declaration authority a closed discriminated union", () => {
    expect(
      publicationClaimDeclarationSchema.safeParse({ authority: "review-manifest" }).success,
    ).toBe(true);
    expect(
      publicationClaimDeclarationSchema.safeParse({
        authority: "review-manifest",
        text: "Restated claim text.",
      }).success,
    ).toBe(false);
    expect(
      publicationClaimDeclarationSchema.safeParse({ authority: "publication-source" }).success,
    ).toBe(false);
    expect(
      publicationClaimDeclarationSchema.safeParse({
        authority: "publication-source",
        text: "Text.",
        claimType: "invented-type",
      }).success,
    ).toBe(false);
  });

  it("holds the selector to its declared frame and code-point arithmetic", () => {
    expect(publicationClaimSelectorSchema.safeParse(selector).success).toBe(true);
    expect(
      publicationClaimSelectorSchema.safeParse({
        ...selector,
        representation: "myst-rendered-text-v1",
      }).success,
    ).toBe(false);
    expect(
      publicationClaimSelectorSchema.safeParse({
        ...selector,
        textPosition: { type: "TextPositionSelector", start: 10, end: 99 },
      }).success,
    ).toBe(false);
  });

  it("counts selector offsets in code points, not UTF-16 code units", () => {
    const astral = "𝛽 rises";
    expect(
      publicationClaimSelectorSchema.safeParse({
        ...selector,
        textQuote: { type: "TextQuoteSelector", exact: astral },
        textPosition: { type: "TextPositionSelector", start: 0, end: 7 },
      }).success,
    ).toBe(true);
    expect(
      publicationClaimSelectorSchema.safeParse({
        ...selector,
        textQuote: { type: "TextQuoteSelector", exact: astral },
        textPosition: { type: "TextPositionSelector", start: 0, end: astral.length },
      }).success,
    ).toBe(false);
  });

  it("rejects an unsafe or inverted source binding", () => {
    expect(
      publicationClaimSourceBindingSchema.safeParse({ ...sourceBinding, documentPath: "../x.md" })
        .success,
    ).toBe(false);
    expect(
      publicationClaimSourceBindingSchema.safeParse({ ...sourceBinding, startLine: 30 }).success,
    ).toBe(false);
  });
});
