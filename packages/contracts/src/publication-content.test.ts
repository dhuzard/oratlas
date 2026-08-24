import { describe, expect, it } from "vitest";
import {
  normalizedPublicationContentSchema,
  publicationContentCompletenessSchema,
  publicationContentDocumentSchema,
  PUBLICATION_VERSION_PACKET_SCHEMA_VERSION,
} from "./publications.js";

describe("generic publication content contracts", () => {
  const document = {
    id: "publication-content:one",
    title: null,
    role: null,
    sourcePath: "content/article.json",
    publishedUrl: "https://example.org/article/",
    representation: "published-structured-text" as const,
    text: "Deterministic scientific text.",
    sha256: "a".repeat(64),
    sourceArtifactIdentitySha256: "b".repeat(64),
    sourceArtifactSha256: "c".repeat(64),
  };

  it("pins the material packet addition to schema 1.2.0", () => {
    expect(PUBLICATION_VERSION_PACKET_SCHEMA_VERSION).toBe("1.2.0");
  });

  it("accepts toolchain-neutral content provenance and optional semantic roles", () => {
    expect(
      publicationContentDocumentSchema.parse({
        ...document,
      }),
    ).toMatchObject({ role: null, representation: "published-structured-text" });
  });

  it("rejects dishonest complete and unsupported coverage", () => {
    expect(() =>
      publicationContentCompletenessSchema.parse({
        returnedDocuments: 2,
        totalDocumentsKnown: 3,
        truncated: false,
        coverage: "complete",
      }),
    ).toThrow();
    expect(() =>
      publicationContentCompletenessSchema.parse({
        returnedDocuments: 1,
        totalDocumentsKnown: null,
        truncated: false,
        coverage: "unsupported",
      }),
    ).toThrow();
  });

  it("binds completeness counts and evidence ids to the exact document array", () => {
    const completeness = {
      returnedDocuments: 1,
      totalDocumentsKnown: 1,
      truncated: false,
      coverage: "complete" as const,
    };
    expect(() =>
      normalizedPublicationContentSchema.parse({
        documents: [document],
        completeness: { ...completeness, returnedDocuments: 0 },
      }),
    ).toThrow();
    expect(() =>
      normalizedPublicationContentSchema.parse({
        documents: [document, document],
        completeness: { ...completeness, returnedDocuments: 2, totalDocumentsKnown: 2 },
      }),
    ).toThrow();
  });
});
