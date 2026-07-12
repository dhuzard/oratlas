/**
 * Software Heritage identifiers derived from Git object ids. SWHIDs embed
 * SHA-1 object ids, so they are only defined for 40-hex ids; repositories
 * using the SHA-256 object format (64-hex) get no SWHID.
 */

const GIT_SHA1 = /^[0-9a-f]{40}$/;

export function swhidForRevision(commitSha: string): string | undefined {
  return GIT_SHA1.test(commitSha) ? `swh:1:rev:${commitSha}` : undefined;
}

export function swhidForDirectory(treeSha: string): string | undefined {
  return GIT_SHA1.test(treeSha) ? `swh:1:dir:${treeSha}` : undefined;
}

/**
 * Public archive resolver for a SWHID. Callers must not emit this URL for
 * example/synthetic versions — their object ids do not exist in the archive.
 */
export function swhidArchiveUrl(swhid: string): string {
  return `https://archive.softwareheritage.org/${swhid}/`;
}
