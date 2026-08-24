import { describe, expect, it } from "vitest";
import {
  deriveObservedPublicationBaseUrl,
  resolveObservedPublicationBaseUrl,
} from "./publication-addressing.js";

describe("observed publication addressing", () => {
  it("prefers the observed manifest URL and derives only its directory", () => {
    expect(
      deriveObservedPublicationBaseUrl({
        requestedUrl: "https://requested.example/oratlas.manifest.json",
        observedUrl: "https://observed.example/article/oratlas.manifest.json?cache=1#ignored",
      }),
    ).toBe("https://observed.example/article/");
  });

  it("falls back to an immutable Phase-2 manifest capture without fabricating canonical data", () => {
    expect(
      resolveObservedPublicationBaseUrl({
        observedPublicationBaseUrl: null,
        captures: [
          {
            artifactKind: "publication-manifest",
            requestedUrl: "https://legacy.example/review/oratlas.manifest.json",
            observedUrl: null,
          },
        ],
      }),
    ).toBe("https://legacy.example/review/");
  });

  it("fails closed when retained and captured observed addressing disagree", () => {
    expect(
      resolveObservedPublicationBaseUrl({
        observedPublicationBaseUrl: "https://retained.example/article/",
        captures: [
          {
            artifactKind: "publication-manifest",
            requestedUrl: "https://captured.example/article/oratlas.manifest.json",
            observedUrl: null,
          },
        ],
      }),
    ).toBeNull();
  });
});
