import { z } from "zod";

/**
 * Safe repository-relative path validation.
 *
 * Artifact paths in review manifests point at files inside the submitted
 * repository. They must never escape the repository root or smuggle in URL
 * schemes, so we reject absolute paths, drive letters, `..` segments,
 * backslashes, control characters, and anything containing a `:`.
 */
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;
export const MAX_REPO_PATH_LENGTH = 512;

export function isSafeRepoRelativePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_REPO_PATH_LENGTH) {
    return false;
  }
  if (CONTROL_CHARS_RE.test(path)) return false;
  if (path.includes("\\") || path.includes(":")) return false;
  if (path.startsWith("/") || path.startsWith("~")) return false;
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return false;
    if (!SEGMENT_RE.test(segment)) return false;
  }
  return true;
}

export const safeRepoRelativePathSchema = z
  .string()
  .max(MAX_REPO_PATH_LENGTH)
  .refine(isSafeRepoRelativePath, {
    message:
      "Must be a safe repository-relative path (no absolute paths, no '..', no schemes, no backslashes).",
  });
