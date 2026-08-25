import "server-only";
import {
  publicationContributorIdentifierSchema,
  publicationContributorRoleSchema,
  publicationContributorSourceDeclarationProvenanceSchema,
  publicationContributorsResponseSchema,
  publicPublicationContributorSchema,
  PUBLICATION_CONTRIBUTOR_LIMIT,
} from "@oratlas/contracts";
import { z } from "zod";
import { prisma } from "./db";

export class PublicationContributorsError extends Error {
  constructor(
    public readonly code: "not-found" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "PublicationContributorsError";
  }
}

function parseJson<T>(raw: string, schema: z.ZodType<T>, label: string): T {
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    throw new PublicationContributorsError(
      "conflict",
      `Stored publication contributor ${label} is invalid.`,
    );
  }
}

export async function listPublicationVersionContributors(publicationVersionId: string) {
  const version = await prisma.publicationVersion.findUnique({
    where: { id: publicationVersionId },
    select: { id: true, contributorsDeclared: true },
  });
  if (!version) {
    throw new PublicationContributorsError("not-found", "Publication version not found.");
  }
  const [rows, total] = await Promise.all([
    prisma.publicationVersionContributor.findMany({
      where: { publicationVersionId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: PUBLICATION_CONTRIBUTOR_LIMIT,
    }),
    prisma.publicationVersionContributor.count({ where: { publicationVersionId } }),
  ]);
  if (!version.contributorsDeclared && total !== 0) {
    throw new PublicationContributorsError(
      "conflict",
      "Stored contributors conflict with the exact version declaration state.",
    );
  }
  const contributors = rows.map((row) =>
    publicPublicationContributorSchema.parse({
      id: row.id,
      publicationVersionId: row.publicationVersionId,
      sourceContributorKey: row.sourceContributorKey,
      kind: row.kind,
      displayName: row.displayName,
      givenName: row.givenName,
      familyName: row.familyName,
      identifiers: parseJson(
        row.identifiersJson,
        z.array(publicationContributorIdentifierSchema).max(20),
        "identifiers",
      ),
      affiliations: parseJson(
        row.affiliationsJson,
        z.array(z.string().trim().min(1).max(300)).max(50),
        "affiliations",
      ),
      roles: parseJson(
        row.rolesJson,
        z.array(publicationContributorRoleSchema).min(1).max(6),
        "roles",
      ),
      position: row.position,
      publicUrl: row.publicUrl,
      sourceDeclarationProvenance: parseJson(
        row.sourceDeclarationProvenanceJson,
        publicationContributorSourceDeclarationProvenanceSchema,
        "source provenance",
      ),
      declarationStatus: "source-declared",
      links: {
        publicationVersion: `/api/publication-versions/${row.publicationVersionId}`,
        publicProfile: row.publicUrl,
      },
    }),
  );
  return publicationContributorsResponseSchema.parse({
    schemaVersion: "1.0.0",
    publicationVersionId,
    declarationStatus: version.contributorsDeclared ? "source-declared" : "not-declared",
    contributors,
    completeness: {
      returned: contributors.length,
      total,
      truncated: contributors.length < total,
      coverage: version.contributorsDeclared ? "complete" : "not-declared",
    },
  });
}
