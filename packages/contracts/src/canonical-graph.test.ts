import { describe, expect, it } from "vitest";
import {
  canonicalGraphSourceSchema,
  PUBLICATION_ADAPTER_TYPES,
  publicationAdapterTypeSchema,
} from "./index.js";

const externalSource = {
  type: "publication-claim-occurrence",
  publicationClaimOccurrenceId: "occurrence-1",
  publicationId: "publication-1",
  publicationVersionId: "publication-version-1",
  publicationType: "research-article",
  sourceLocalClaimId: "claim-1",
  adapterType: "myst",
  structuralProvenance: "published-structure",
  publisherCanonicalUrl: null,
  observedPublicationBaseUrl: "https://observed.example/article/",
  publishedTargetUrl: "https://observed.example/article/results/#claim-1",
  captureIds: ["capture-1"],
  sourcesSha256: "a".repeat(64),
} as const;

describe("canonical graph publication adapter vocabulary", () => {
  it("accepts exactly the shared publication adapter vocabulary", () => {
    const externalContract = canonicalGraphSourceSchema.options.find(
      (option) => option.shape.type.safeParse("publication-claim-occurrence").success,
    );
    expect(
      externalContract && "adapterType" in externalContract.shape
        ? externalContract.shape.adapterType
        : undefined,
    ).toBe(publicationAdapterTypeSchema);
    for (const adapterType of PUBLICATION_ADAPTER_TYPES) {
      expect(publicationAdapterTypeSchema.parse(adapterType)).toBe(adapterType);
      const parsed = canonicalGraphSourceSchema.parse({ ...externalSource, adapterType });
      expect(parsed.type).toBe("publication-claim-occurrence");
      if (parsed.type === "publication-claim-occurrence") {
        expect(parsed.adapterType).toBe(adapterType);
      }
    }
    expect(() =>
      canonicalGraphSourceSchema.parse({ ...externalSource, adapterType: "invented" }),
    ).toThrow();
  });
});
