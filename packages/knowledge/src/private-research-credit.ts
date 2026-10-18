import { privateCrossFindingSchema, type PrivateCrossFinding } from "@oratlas/contracts";

/**
 * Pure, private-only projection; never use in /api/graph, public archive,
 * global indexing, feeds, public exports or shared AI prompts.
 *
 * The caller MUST authenticate the principal and MUST supply an authoritative
 * project-policy checker; ORCID, citation, claim author or a source-provided
 * role string is never an entitlement. The checker must consult up-to-date
 * membership AND cross-project processing policy on each request.
 *
 * This is a defense-in-depth projection, NOT a replacement for authorization
 * at the database/connector read boundary. Load candidate/source bytes only
 * after the primary store has authorized their access.
 */
export type PrivateResearchPermission = "read" | "cross-project-process";

export interface PrivateResearchPermissionRequest {
  principalId: string;
  projectId: string;
  permission: PrivateResearchPermission;
}

export type AuthorizePrivateResearchProject = (
  request: PrivateResearchPermissionRequest,
) => boolean | Promise<boolean>;

/**
 * Returns null, with no rejection reason or source metadata, if any private
 * source is inaccessible or unauthorized for cross-project analysis. A missing
 * record and a forbidden record are indistinguishable to callers.
 *
 * No global graph, database write, AI call, cache or notifications occur here.
 */
export async function projectPersonalResearchCredit(
  candidate: unknown,
  principalId: string | null | undefined,
  authorize: AuthorizePrivateResearchProject,
): Promise<PrivateCrossFinding | null> {
  if (!principalId || typeof principalId !== "string") return null;
  const parsed = privateCrossFindingSchema.safeParse(candidate);
  if (!parsed.success) return null;

  const record = parsed.data;
  if (record.ownerSubjectId !== principalId) return null;

  try {
    for (const source of record.sources) {
      const input = { principalId, projectId: source.projectId };
      if ((await authorize({ ...input, permission: "read" })) !== true) return null;
      if ((await authorize({ ...input, permission: "cross-project-process" })) !== true) {
        return null;
      }
    }
  } catch {
    // A failing or unavailable membership/consent service must never grant access.
    return null;
  }

  // Parsed, strict DTO: exact source refs and *asserted* human credit retained.
  // No status upgrades, AI-as-human attribution, global relation or disclosure.
  return record;
}
