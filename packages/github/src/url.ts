import { githubOwnerSchema, githubRepoNameSchema, type RepoRef } from "@oratlas/contracts";

export interface UrlParseSuccess {
  ok: true;
  ref: RepoRef;
}
export interface UrlParseFailure {
  ok: false;
  reason: string;
}
export type UrlParseResult = UrlParseSuccess | UrlParseFailure;

const ALLOWED_HOSTS = new Set(["github.com", "www.github.com"]);

/**
 * Blocked owner segments that are GitHub product/namespace paths rather than
 * user/org logins — prevents "repositories" like github.com/settings/x.
 */
const RESERVED_OWNERS = new Set([
  "settings",
  "marketplace",
  "sponsors",
  "features",
  "topics",
  "collections",
  "trending",
  "notifications",
  "explore",
  "apps",
  "organizations",
  "login",
  "join",
  "about",
  "pricing",
  "orgs",
  "users",
  "search",
]);

/**
 * Normalize and validate a public GitHub repository URL (spec §6).
 *
 * Rejects: non-GitHub hosts, malformed URLs, embedded credentials, arbitrary
 * API endpoints (api.github.com), non-standard ports, local-network / IP
 * targets, and anything that does not resolve to exactly
 * `https://github.com/{owner}/{repo}`. This is the SSRF choke point: only the
 * canonical host + owner/repo pair can ever reach the network layer.
 */
export function parseGithubRepoUrl(input: string): UrlParseResult {
  if (typeof input !== "string") return { ok: false, reason: "URL must be a string." };
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: "URL is empty." };
  if (trimmed.length > 2048) return { ok: false, reason: "URL is too long." };

  // Reject scp-like git syntax and any embedded credentials up front.
  if (trimmed.includes("@")) {
    return { ok: false, reason: "URLs containing credentials or '@' are not allowed." };
  }

  let raw = trimmed;
  if (!/^https?:\/\//i.test(raw)) {
    // Accept "github.com/owner/repo" and "owner/repo" shorthands.
    if (/^github\.com\//i.test(raw)) {
      raw = `https://${raw}`;
    } else if (/^[^/\s]+\/[^/\s]+$/.test(raw)) {
      raw = `https://github.com/${raw}`;
    } else {
      return { ok: false, reason: "Not a recognizable GitHub repository URL." };
    }
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Malformed URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: `Unsupported protocol '${url.protocol}'.` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs containing credentials are not allowed." };
  }
  if (url.port && url.port !== "" && url.port !== "443" && url.port !== "80") {
    return { ok: false, reason: "Non-standard ports are not allowed." };
  }
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    if (host === "api.github.com" || host === "raw.githubusercontent.com") {
      return { ok: false, reason: "Direct GitHub API/content endpoints are not accepted." };
    }
    return { ok: false, reason: `Only github.com repository URLs are accepted (got '${host}').` };
  }

  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length < 2) {
    return { ok: false, reason: "URL must include an owner and repository name." };
  }
  const owner = segments[0]!;
  let name = segments[1]!;
  // Strip a trailing ".git" and ignore deep paths (tree/blob/commit/…).
  if (name.toLowerCase().endsWith(".git")) name = name.slice(0, -4);

  if (RESERVED_OWNERS.has(owner.toLowerCase())) {
    return { ok: false, reason: `'${owner}' is a reserved GitHub path, not a repository owner.` };
  }
  const ownerParsed = githubOwnerSchema.safeParse(owner);
  if (!ownerParsed.success) return { ok: false, reason: "Invalid repository owner." };
  const nameParsed = githubRepoNameSchema.safeParse(name);
  if (!nameParsed.success) return { ok: false, reason: "Invalid repository name." };

  const canonicalUrl = `https://github.com/${ownerParsed.data}/${nameParsed.data}`;
  return {
    ok: true,
    ref: {
      host: "github.com",
      owner: ownerParsed.data,
      name: nameParsed.data,
      canonicalUrl,
    },
  };
}
