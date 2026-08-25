import { z } from "zod";
import {
  publicationCaptureArtifactKindSchema,
  publicationHttpsUrlSchema,
  publicationSha256Schema,
} from "./publications.js";

/** Maximum exact-version contributor snapshots accepted from one adapter. */
export const PUBLICATION_CONTRIBUTOR_LIMIT = 500;

export const PUBLICATION_CONTRIBUTOR_KINDS = ["person", "organization"] as const;
export const publicationContributorKindSchema = z.enum(PUBLICATION_CONTRIBUTOR_KINDS);

/** Ordered, toolchain-neutral scholarly-credit roles. */
export const PUBLICATION_CONTRIBUTOR_ROLES = [
  "author",
  "corresponding-author",
  "editor",
  "group-author",
  "contributor",
  "other",
] as const;
export const publicationContributorRoleSchema = z.enum(PUBLICATION_CONTRIBUTOR_ROLES);

/** Declared identifier schemes are retained as metadata and never resolved into identity. */
export const PUBLICATION_CONTRIBUTOR_IDENTIFIER_SCHEMES = [
  "orcid",
  "ror",
  "isni",
  "other",
] as const;
export const publicationContributorIdentifierSchemeSchema = z.enum(
  PUBLICATION_CONTRIBUTOR_IDENTIFIER_SCHEMES,
);

export const publicationContributorIdentifierSchema = z
  .object({
    scheme: publicationContributorIdentifierSchemeSchema,
    value: z.string().trim().min(1).max(300),
  })
  .strict();

export const publicationContributorSourceKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, {
    message:
      "Must start with an alphanumeric character and contain only letters, digits, '.', '_', ':' or '-'.",
  });

/** Exact captured declaration that supplied the contributor snapshot. */
export const publicationContributorSourceDeclarationProvenanceSchema = z
  .object({
    type: z.literal("source-declared"),
    sourceArtifactKind: publicationCaptureArtifactKindSchema,
    sourceArtifactIdentitySha256: publicationSha256Schema,
    sourceArtifactSha256: publicationSha256Schema,
  })
  .strict();

const contributorDeclarationFields = {
  sourceContributorKey: publicationContributorSourceKeySchema,
  kind: publicationContributorKindSchema,
  displayName: z.string().trim().min(1).max(300),
  givenName: z.string().trim().min(1).max(200).optional(),
  familyName: z.string().trim().min(1).max(200).optional(),
  identifiers: z.array(publicationContributorIdentifierSchema).max(20).default([]),
  affiliations: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  roles: z.array(publicationContributorRoleSchema).min(1).max(6),
  position: z.number().int().positive().max(PUBLICATION_CONTRIBUTOR_LIMIT),
  publicUrl: publicationHttpsUrlSchema.optional(),
  sourceDeclarationProvenance: publicationContributorSourceDeclarationProvenanceSchema,
} as const;

function validateContributorFields(
  value: {
    kind: "person" | "organization";
    givenName?: string | null;
    familyName?: string | null;
    identifiers: Array<{ scheme: string; value: string }>;
    affiliations: string[];
    roles: string[];
  },
  context: z.RefinementCtx,
) {
  if (value.kind === "organization" && (value.givenName != null || value.familyName != null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [value.givenName != null ? "givenName" : "familyName"],
      message: "Organization contributors cannot declare person-name fields.",
    });
  }
  for (const [path, values] of [
    [
      "identifiers",
      value.identifiers.map((identifier) => `${identifier.scheme}:${identifier.value}`),
    ],
    ["affiliations", value.affiliations],
    ["roles", value.roles],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path],
        message: `${path} must not contain duplicates.`,
      });
    }
  }
}

/** Framework-independent adapter output for one source-declared contributor. */
export const normalizedPublicationContributorSchema = z
  .object(contributorDeclarationFields)
  .strict()
  .superRefine(validateContributorFields);
export type NormalizedPublicationContributor = z.infer<
  typeof normalizedPublicationContributorSchema
>;

/**
 * The array order and positions are both explicit. Adapters must return the
 * exact declared order; registration never reorders or infers contributors.
 */
export const normalizedPublicationContributorsSchema = z
  .array(normalizedPublicationContributorSchema)
  .max(PUBLICATION_CONTRIBUTOR_LIMIT)
  .superRefine((contributors, context) => {
    const keys = new Set<string>();
    const positions = new Set<number>();
    contributors.forEach((contributor, index) => {
      if (keys.has(contributor.sourceContributorKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "sourceContributorKey"],
          message: "Source contributor keys must be unique within a publication version.",
        });
      }
      if (positions.has(contributor.position)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "position"],
          message: "Contributor positions must be unique within a publication version.",
        });
      }
      if (contributor.position !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "position"],
          message: "Contributors must be returned in contiguous one-based declared order.",
        });
      }
      keys.add(contributor.sourceContributorKey);
      positions.add(contributor.position);
    });
  });

export const publicPublicationContributorSchema = z
  .object({
    id: z.string().min(1),
    publicationVersionId: z.string().min(1),
    ...contributorDeclarationFields,
    identifiers: z.array(publicationContributorIdentifierSchema).max(20),
    affiliations: z.array(z.string().trim().min(1).max(300)).max(50),
    givenName: z.string().trim().min(1).max(200).nullable(),
    familyName: z.string().trim().min(1).max(200).nullable(),
    publicUrl: publicationHttpsUrlSchema.nullable(),
    declarationStatus: z.literal("source-declared"),
    links: z
      .object({
        publicationVersion: z.string().startsWith("/"),
        publicProfile: publicationHttpsUrlSchema.nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine(validateContributorFields);
export type PublicPublicationContributor = z.infer<typeof publicPublicationContributorSchema>;

export const publicationContributorsResponseSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    publicationVersionId: z.string().min(1),
    declarationStatus: z.enum(["source-declared", "not-declared"]),
    contributors: z.array(publicPublicationContributorSchema).max(PUBLICATION_CONTRIBUTOR_LIMIT),
    completeness: z
      .object({
        returned: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        truncated: z.boolean(),
        coverage: z.enum(["complete", "not-declared"]),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.completeness.returned !== value.contributors.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completeness", "returned"],
        message: "Contributor completeness must match the returned snapshots.",
      });
    }
    if (
      value.completeness.returned > value.completeness.total ||
      value.completeness.truncated !== value.completeness.returned < value.completeness.total
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completeness"],
        message: "Contributor completeness totals and truncation must agree.",
      });
    }
    const declared = value.declarationStatus === "source-declared";
    if (declared !== (value.completeness.coverage === "complete")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completeness", "coverage"],
        message:
          "Contributor coverage must reflect whether the exact version declared contributors.",
      });
    }
    if (!declared && (value.contributors.length !== 0 || value.completeness.total !== 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contributors"],
        message: "An undeclared contributor snapshot must remain empty.",
      });
    }
  });
export type PublicationContributorsResponse = z.infer<typeof publicationContributorsResponseSchema>;
