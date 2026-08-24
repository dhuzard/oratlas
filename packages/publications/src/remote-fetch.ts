import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

interface LookupAddress {
  address: string;
  family: number;
}

/**
 * One reusable SSRF boundary for every externally hosted publication byte.
 * Redirects are followed manually, every destination is re-resolved, and the
 * selected address is pinned into the socket lookup to narrow the DNS-rebind
 * window between validation and connection.
 */

export const DEFAULT_REMOTE_FETCH_LIMITS = {
  maxRedirects: 4,
  connectTimeoutMs: 5_000,
  readTimeoutMs: 10_000,
} as const;

export interface RemoteFetchRequest {
  maxBytes: number;
  acceptedMediaTypes: readonly string[];
  signal?: AbortSignal;
}

export interface RemoteRedirect {
  status: number;
  from: string;
  to: string;
}

export interface RemoteHttpProvenance {
  status: number;
  redirects: RemoteRedirect[];
  headers: Record<string, string>;
}

export interface RemoteFetchResult {
  requestedUrl: string;
  finalUrl: string;
  mediaType: string;
  bytes: Uint8Array;
  provenance: RemoteHttpProvenance;
}

export interface RemoteFetcher {
  fetch(url: string, request: RemoteFetchRequest): Promise<RemoteFetchResult>;
}

export class RemoteFetchError extends Error {
  constructor(
    public readonly code:
      | "unsafe-url"
      | "unsafe-destination"
      | "redirect-limit"
      | "response-too-large"
      | "timeout"
      | "content-type"
      | "http-status"
      | "network",
    message: string,
  ) {
    super(message);
    this.name = "RemoteFetchError";
  }
}

export interface HardenedRemoteFetcherOptions {
  maxRedirects?: number;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  resolver?: (hostname: string) => Promise<readonly LookupAddress[]>;
  /** Test-only escape hatch for deterministic loopback HTTP fixtures. */
  allowHttpForTests?: boolean;
  /** Test-only escape hatch; production construction rejects this option. */
  allowPrivateAddressesForTests?: boolean;
  /** Test-only escape hatch for ephemeral fixture ports. */
  allowNonDefaultPortsForTests?: boolean;
}

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

function normalizedHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
}

function parseExternalUrl(
  value: string,
  options: Required<
    Pick<HardenedRemoteFetcherOptions, "allowHttpForTests" | "allowNonDefaultPortsForTests">
  >,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RemoteFetchError("unsafe-url", "The external URL is malformed.");
  }
  if (url.href.length > 2_000 || url.username || url.password || url.hash) {
    throw new RemoteFetchError(
      "unsafe-url",
      "External URLs must be bounded and contain no credentials or fragment.",
    );
  }
  if (url.protocol !== "https:" && !(options.allowHttpForTests && url.protocol === "http:")) {
    throw new RemoteFetchError("unsafe-url", "External publication fetching requires HTTPS.");
  }
  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expectedPort && !options.allowNonDefaultPortsForTests) {
    throw new RemoteFetchError("unsafe-url", "Non-default external URL ports are not allowed.");
  }
  const hostname = normalizedHostname(url);
  if (
    hostname.length === 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (isIP(hostname) === 0 && !hostname.includes("."))
  ) {
    throw new RemoteFetchError("unsafe-destination", "Local and internal hosts are not allowed.");
  }
  return url;
}

function selectedHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const name of ["content-type", "content-length", "etag", "last-modified", "date"]) {
    const value = headers[name];
    if (typeof value === "string") selected[name] = value.slice(0, 1_000);
  }
  return selected;
}

function mediaTypeOf(value: string | undefined): string {
  return (value ?? "application/octet-stream").split(";", 1)[0]!.trim().toLowerCase();
}

function matchesMediaType(mediaType: string, accepted: readonly string[]): boolean {
  return accepted.some(
    (candidate) =>
      mediaType === candidate ||
      (candidate.endsWith("/*") && mediaType.startsWith(candidate.slice(0, -1))),
  );
}

async function defaultResolver(hostname: string): Promise<readonly LookupAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(new RemoteFetchError("timeout", "The external fetch operation was cancelled."));
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      () => {
        cleanup();
        reject(new RemoteFetchError("network", "The external host could not be resolved."));
      },
    );
  });
}

interface SingleResponse {
  status: number;
  headers: IncomingHttpHeaders;
  bytes: Uint8Array;
}

export function createHardenedRemoteFetcher(
  options: HardenedRemoteFetcherOptions = {},
): RemoteFetcher {
  if (
    process.env.NODE_ENV === "production" &&
    (options.allowHttpForTests ||
      options.allowPrivateAddressesForTests ||
      options.allowNonDefaultPortsForTests)
  ) {
    throw new Error("Test-only remote-fetch exceptions cannot be enabled in production.");
  }
  const maxRedirects = options.maxRedirects ?? DEFAULT_REMOTE_FETCH_LIMITS.maxRedirects;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_REMOTE_FETCH_LIMITS.connectTimeoutMs;
  const readTimeoutMs = options.readTimeoutMs ?? DEFAULT_REMOTE_FETCH_LIMITS.readTimeoutMs;
  const resolver = options.resolver ?? defaultResolver;
  const urlOptions = {
    allowHttpForTests: options.allowHttpForTests ?? false,
    allowNonDefaultPortsForTests: options.allowNonDefaultPortsForTests ?? false,
  };

  async function resolvePinnedAddress(url: URL, signal?: AbortSignal): Promise<LookupAddress> {
    const hostname = normalizedHostname(url);
    const literalFamily = isIP(hostname);
    let addresses: readonly LookupAddress[];
    try {
      addresses = literalFamily
        ? [{ address: hostname, family: literalFamily }]
        : await withAbort(resolver(hostname), signal);
    } catch (error) {
      if (error instanceof RemoteFetchError) throw error;
      throw new RemoteFetchError("network", "The external host could not be resolved.");
    }
    if (addresses.length === 0) {
      throw new RemoteFetchError("network", "The external host did not resolve.");
    }
    if (
      !options.allowPrivateAddressesForTests &&
      addresses.some((candidate) => !isPublicNetworkAddress(candidate.address))
    ) {
      throw new RemoteFetchError(
        "unsafe-destination",
        "The external host resolves to a non-public network destination.",
      );
    }
    return addresses[0]!;
  }

  async function requestOnce(
    url: URL,
    pinned: LookupAddress,
    input: RemoteFetchRequest,
  ): Promise<SingleResponse> {
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) {
      throw new Error("A positive safe response-byte limit is required.");
    }
    return new Promise<SingleResponse>((resolve, reject) => {
      let settled = false;
      let connectTimer: ReturnType<typeof setTimeout> | undefined;
      let cleanupAbort = () => {};
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = undefined;
        }
        cleanupAbort();
        reject(error);
      };
      const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = requester(
        url,
        {
          method: "GET",
          headers: {
            Accept: input.acceptedMediaTypes.join(", "),
            "User-Agent": "ORAtlas-publication-registration/1.0",
          },
          lookup: (_hostname, lookupOptions, callback) => {
            if (typeof lookupOptions === "object" && lookupOptions.all) {
              (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, [
                pinned,
              ]);
            } else {
              callback(null, pinned.address, pinned.family);
            }
          },
        },
        (response) => {
          if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = undefined;
          }
          const status = response.statusCode ?? 0;
          const declaredLength = Number(response.headers["content-length"]);
          if (Number.isFinite(declaredLength) && declaredLength > input.maxBytes) {
            response.destroy();
            fail(
              new RemoteFetchError(
                "response-too-large",
                `The external response exceeds the ${input.maxBytes}-byte limit.`,
              ),
            );
            return;
          }
          response.setTimeout(readTimeoutMs, () => {
            response.destroy();
            fail(new RemoteFetchError("timeout", "The external response read timed out."));
          });
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer) => {
            total += chunk.byteLength;
            if (total > input.maxBytes) {
              response.destroy();
              fail(
                new RemoteFetchError(
                  "response-too-large",
                  `The external response exceeds the ${input.maxBytes}-byte limit.`,
                ),
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            if (settled) return;
            settled = true;
            cleanupAbort();
            resolve({ status, headers: response.headers, bytes: Buffer.concat(chunks) });
          });
          response.on("error", fail);
        },
      );
      connectTimer = setTimeout(() => {
        req.destroy();
        fail(new RemoteFetchError("timeout", "The external connection timed out."));
      }, connectTimeoutMs);
      req.setTimeout(readTimeoutMs, () => {
        req.destroy();
        fail(new RemoteFetchError("timeout", "The external response read timed out."));
      });
      const onAbort = () => {
        req.destroy();
        fail(new RemoteFetchError("timeout", "The external fetch operation was cancelled."));
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });
      cleanupAbort = () => input.signal?.removeEventListener("abort", onAbort);
      req.on("socket", (socket) => {
        if (!socket.connecting) {
          if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = undefined;
          }
          return;
        }
        const event = url.protocol === "https:" ? "secureConnect" : "connect";
        socket.once(event, () => {
          if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = undefined;
          }
        });
      });
      req.on("error", (error) =>
        fail(
          error instanceof RemoteFetchError
            ? error
            : new RemoteFetchError("network", "The external request failed."),
        ),
      );
      req.end();
    });
  }

  return {
    async fetch(value, input) {
      const requested = parseExternalUrl(value, urlOptions);
      let current = requested;
      const redirects: RemoteRedirect[] = [];
      for (;;) {
        if (input.signal?.aborted) {
          throw new RemoteFetchError("timeout", "The external fetch operation was cancelled.");
        }
        const pinned = await resolvePinnedAddress(current, input.signal);
        const response = await requestOnce(current, pinned, input);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.location;
          if (!location) {
            throw new RemoteFetchError("http-status", "The redirect response has no location.");
          }
          if (redirects.length >= maxRedirects) {
            throw new RemoteFetchError(
              "redirect-limit",
              "The external redirect limit was exceeded.",
            );
          }
          let destinationValue: string;
          try {
            destinationValue = new URL(location, current).href;
          } catch {
            throw new RemoteFetchError("unsafe-url", "The redirect location is malformed.");
          }
          const destination = parseExternalUrl(destinationValue, urlOptions);
          redirects.push({ status: response.status, from: current.href, to: destination.href });
          current = destination;
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          throw new RemoteFetchError(
            "http-status",
            "The external server returned an error status.",
          );
        }
        const mediaType = mediaTypeOf(
          typeof response.headers["content-type"] === "string"
            ? response.headers["content-type"]
            : undefined,
        );
        if (
          mediaType === "text/html" ||
          mediaType === "application/xhtml+xml" ||
          mediaType.includes("javascript") ||
          !matchesMediaType(mediaType, input.acceptedMediaTypes)
        ) {
          throw new RemoteFetchError(
            "content-type",
            "The external response has an unexpected content type.",
          );
        }
        return {
          requestedUrl: requested.href,
          finalUrl: current.href,
          mediaType,
          bytes: response.bytes,
          provenance: {
            status: response.status,
            redirects,
            headers: selectedHeaders(response.headers),
          },
        };
      }
    },
  };
}
