import { describe, expect, it } from "vitest";
import {
  normalizedPublicationContributorSchema,
  normalizedPublicationContributorsSchema,
  publicationContributorsResponseSchema,
} from "./publication-contributors.js";

const sha = (value: string) => value.repeat(64).slice(0, 64);

function contributor(overrides: Record<string, unknown> = {}) {
  return {
    sourceContributorKey: "alice",
    kind: "person" as const,
    displayName: "Alice Example",
    givenName: "Alice",
    familyName: "Example",
    identifiers: [{ scheme: "orcid" as const, value: "0000-0002-1825-0097" }],
    affiliations: ["Example University"],
    roles: ["author" as const, "corresponding-author" as const],
    position: 1,
    publicUrl: "https://example.org/alice",
    sourceDeclarationProvenance: {
      type: "source-declared" as const,
      sourceArtifactKind: "publication-manifest" as const,
      sourceArtifactIdentitySha256: sha("a"),
      sourceArtifactSha256: sha("b"),
    },
    ...overrides,
  };
}

describe("generic exact-version contributor contracts", () => {
  it("retains deterministic person credit, ordered roles, affiliation, and ORCID as metadata", () => {
    const parsed = normalizedPublicationContributorSchema.parse(contributor());
    expect(parsed).toMatchObject({
      kind: "person",
      displayName: "Alice Example",
      roles: ["author", "corresponding-author"],
      identifiers: [{ scheme: "orcid", value: "0000-0002-1825-0097" }],
      affiliations: ["Example University"],
    });
    expect(parsed).not.toHaveProperty("personId");
    expect(parsed).not.toHaveProperty("productionMode");
  });

  it("represents organization and group authorship without person-name fields", () => {
    expect(
      normalizedPublicationContributorSchema.parse(
        contributor({
          sourceContributorKey: "consortium",
          kind: "organization",
          displayName: "Atlas Consortium",
          givenName: undefined,
          familyName: undefined,
          identifiers: [{ scheme: "ror", value: "https://ror.org/03yrm5c26" }],
          roles: ["group-author"],
        }),
      ),
    ).toMatchObject({ kind: "organization", roles: ["group-author"] });
    expect(
      normalizedPublicationContributorSchema.safeParse(
        contributor({ kind: "organization", givenName: "Not allowed" }),
      ).success,
    ).toBe(false);
  });

  it("requires unique source keys and contiguous source-declared order", () => {
    const bob = contributor({
      sourceContributorKey: "bob",
      displayName: "Bob Example",
      position: 2,
    });
    expect(normalizedPublicationContributorsSchema.parse([contributor(), bob])).toHaveLength(2);
    expect(
      normalizedPublicationContributorsSchema.safeParse([
        contributor(),
        { ...bob, sourceContributorKey: "alice" },
      ]).success,
    ).toBe(false);
    expect(
      normalizedPublicationContributorsSchema.safeParse([contributor(), { ...bob, position: 3 }])
        .success,
    ).toBe(false);
  });

  it.each(["space key", "/absolute", "", "?query"])(
    "rejects malformed source contributor key %j",
    (sourceContributorKey) => {
      expect(
        normalizedPublicationContributorSchema.safeParse(contributor({ sourceContributorKey }))
          .success,
      ).toBe(false);
    },
  );

  it("exposes explicit not-declared completeness without fabricating contributors", () => {
    expect(
      publicationContributorsResponseSchema.parse({
        schemaVersion: "1.0.0",
        publicationVersionId: "version-1",
        declarationStatus: "not-declared",
        contributors: [],
        completeness: {
          returned: 0,
          total: 0,
          truncated: false,
          coverage: "not-declared",
        },
      }),
    ).toMatchObject({ declarationStatus: "not-declared", contributors: [] });
  });
});
