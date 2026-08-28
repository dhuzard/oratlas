import { classifyIpAddress, describeAddressClass, isIpLiteral } from "./address.js";

/**
 * URL admission rules for outbound requests to destinations ORAtlas does not
 * control.
 *
 * Every rejection returns a stable machine code and a message safe to show a
 * caller. Nothing here reveals resolved addresses, internal hostnames, or
 * anything else about ORAtlas's own network.
 */

export const SAFE_FETCH_ERROR_CODES = [
  "url-malformed",
  "url-too-long",
  "url-scheme-not-allowed",
  "url-credentials-not-allowed",
  "url-port-not-allowed",
  "url-host-not-allowed",
  "destination-not-public",
  "redirect-not-allowed",
  "too-many-redirects",
  "response-too-large",
  "content-type-not-allowed",
  "http-status",
  "timeout",
  "network-error",
] as const;
export type SafeFetchErrorCode = (typeof SAFE_FETCH_ERROR_CODES)[number];

/**
 * How permissive an outbound request may be.
 *
 * The defaults are the production posture: https only, public destinations
 * only, standard ports only. Every relaxation is an explicit opt-in a caller
 * has to write down, so a test fixture or a development instance can never be
 * mistaken for the deployed policy.
 */
export interface UrlSafetyPolicy {
  /** Permit `http://`. Off in production: external registration is https-only. */
  allowInsecureHttp?: boolean;
  /** Permit loopback destinations. For local fixtures and development only. */
  allowLoopback?: boolean;
  /** Permit RFC 1918 / unique-local destinations. For self-hosted mirrors only. */
  allowPrivateNetworks?: boolean;
  /** Permit ports other than 80/443. Implied by fixtures on ephemeral ports. */
  allowNonStandardPorts?: boolean;
  /** Hard cap on the URL length ORAtlas will even parse. */
  maxUrlLength?: number;
}

export interface ResolvedUrlSafetyPolicy extends Required<UrlSafetyPolicy> {}

export const DEFAULT_URL_SAFETY_POLICY: ResolvedUrlSafetyPolicy = {
  allowInsecureHttp: false,
  allowLoopback: false,
  allowPrivateNetworks: false,
  allowNonStandardPorts: false,
  maxUrlLength: 2_000,
};

export function resolveUrlSafetyPolicy(policy: UrlSafetyPolicy = {}): ResolvedUrlSafetyPolicy {
  return { ...DEFAULT_URL_SAFETY_POLICY, ...policy };
}

export type UrlSafetyResult =
  | { ok: true; url: URL }
  | { ok: false; code: SafeFetchErrorCode; reason: string };

/**
 * Host suffixes that name something inside a private deployment rather than a
 * public destination. Split-horizon DNS makes these resolve to real internal
 * services, so they are refused by name before any resolution happens.
 */
const INTERNAL_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".corp",
  ".home",
  ".home.arpa",
  ".localdomain",
  ".test",
  ".invalid",
  ".onion",
];

const INTERNAL_HOST_NAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "ip6-localhost",
  "ip6-loopback",
]);

/**
 * Admit a URL as an outbound destination, or reject it with a stable code.
 *
 * Name-based checks only: a hostname that passes here still has every resolved
 * address classified at connect time (see `safeFetch`), because DNS is
 * attacker-controlled and can change between the two.
 */
export function assessExternalUrl(input: unknown, policy: UrlSafetyPolicy = {}): UrlSafetyResult {
  const resolved = resolveUrlSafetyPolicy(policy);
  if (typeof input !== "string" || input.trim().length === 0) {
    return { ok: false, code: "url-malformed", reason: "A URL string is required." };
  }
  const candidate = input.trim();
  if (candidate.length > resolved.maxUrlLength) {
    return {
      ok: false,
      code: "url-too-long",
      reason: `A URL may be at most ${resolved.maxUrlLength} characters.`,
    };
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, code: "url-malformed", reason: "The URL could not be parsed." };
  }

  const allowedSchemes = resolved.allowInsecureHttp ? ["https:", "http:"] : ["https:"];
  if (!allowedSchemes.includes(url.protocol)) {
    return {
      ok: false,
      code: "url-scheme-not-allowed",
      reason: "Only https:// URLs are accepted.",
    };
  }
  if (url.username !== "" || url.password !== "") {
    return {
      ok: false,
      code: "url-credentials-not-allowed",
      reason: "A URL carrying credentials is not accepted.",
    };
  }
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  if (url.port !== "" && url.port !== defaultPort && !resolved.allowNonStandardPorts) {
    return {
      ok: false,
      code: "url-port-not-allowed",
      reason: "Only the default port for the scheme is accepted.",
    };
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname.length === 0) {
    return { ok: false, code: "url-host-not-allowed", reason: "The URL has no host." };
  }

  if (isIpLiteral(hostname)) {
    const addressClass = classifyIpAddress(hostname)!;
    if (!isAddressClassAllowed(addressClass, resolved)) {
      return {
        ok: false,
        code: "url-host-not-allowed",
        reason: `The URL names ${describeAddressClass(addressClass)}.`,
      };
    }
    return { ok: true, url };
  }

  const internalByName =
    INTERNAL_HOST_NAMES.has(hostname) ||
    INTERNAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  if (internalByName && !(resolved.allowLoopback || resolved.allowPrivateNetworks)) {
    return {
      ok: false,
      code: "url-host-not-allowed",
      reason: "The URL names an internal or non-public host.",
    };
  }
  // A single-label host ("intranet") can only be resolved through a private
  // search domain, so it is never a public internet destination.
  if (!hostname.includes(".") && !(resolved.allowLoopback || resolved.allowPrivateNetworks)) {
    return {
      ok: false,
      code: "url-host-not-allowed",
      reason: "The URL names an internal or non-public host.",
    };
  }

  return { ok: true, url };
}

/** Whether a classified destination address is admissible under a policy. */
export function isAddressClassAllowed(
  addressClass: ReturnType<typeof classifyIpAddress>,
  policy: ResolvedUrlSafetyPolicy,
): boolean {
  switch (addressClass) {
    case "public":
      return true;
    case "loopback":
      return policy.allowLoopback;
    case "private":
      return policy.allowPrivateNetworks;
    case "link-local":
    case "cloud-metadata":
    case "unspecified":
    case "multicast":
    case "reserved":
    case null:
      return false;
  }
}
