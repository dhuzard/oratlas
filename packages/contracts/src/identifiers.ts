import { z } from "zod";

/** Full lowercase Git object id: SHA-1 (40 hex) or SHA-256 (64 hex). */
export const commitShaSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, {
  message: "Must be a full 40- or 64-character lowercase Git object id.",
});

/**
 * DOI syntax (not resolution). Accepts the bare `10.xxxx/suffix` form only —
 * normalization from `doi:` / `https://doi.org/` prefixes happens in
 * @oratlas/zenodo before this schema is applied.
 */
export const doiSchema = z.string().regex(/^10\.\d{4,9}\/\S+$/, {
  message: "Must be a bare DOI of the form 10.xxxx/suffix.",
});

export const orcidSchema = z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/, {
  message: "Must be an ORCID iD of the form 0000-0000-0000-0000.",
});

export const zenodoRecordIdSchema = z.string().regex(/^\d+$/, {
  message: "Must be a numeric Zenodo record id.",
});

export const githubOwnerSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, {
    message: "Must be a valid GitHub owner login.",
  });

export const githubRepoNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, { message: "Must be a valid GitHub repository name." })
  .refine((n) => n !== "." && n !== "..", { message: "Invalid repository name." });

/** Canonical comparison key for GitHub's case-insensitive login namespace. */
export function normalizeGitHubLogin(login: string): string {
  return login.normalize("NFKC").toLowerCase();
}

export const httpsUrlSchema = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), { message: "Only https:// URLs are accepted." });
