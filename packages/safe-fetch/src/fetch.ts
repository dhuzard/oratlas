import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import {
  classifyIpAddress,
  describeAddressClass,
  type AddressClass,
} from "./address.js";
import {
  assessExternalUrl,
  isAddressClassAllowed,
  resolveUrlSafetyPolicy,
  type ResolvedUrlSafetyPolicy,
  type SafeFetchErrorCode,
  type UrlSafetyPolicy,
} from "./url-safety.js";

/**
 * The hardened outbound fetch boundary.
 *
 * Everything ORAtlas retrieves from a host it does not control goes through
 * this function. It is deliberately built on `node:http`/`node:https` rather
 * than global `fetch`, because three of its guarantees are not expressible
 * through the fetch API in this runtime:
 *
 * 1. **Connect-time address vetting.** The socket's `lookup` hook classifies
 *    every address the resolver returns, at the moment the connection is made.
 *    A hostname that resolves publicly during validation and privately a
 *    moment later (DNS rebinding) is rejected at connect, not merely at parse.
 * 2. **Manual redirect handling.** Every hop is re-admitted through the full
 *    URL policy, so a public URL cannot redirect into a private one.
 * 3. **Byte accounting during streaming**, so an oversized body is aborted
 *    mid-flight rather than buffered and then measured.
 *
 * The response is returned as exact bytes plus their digest. Nothing is
 * decoded, parsed, rendered or executed here: no JavaScript, no HTML, no
 * plugin, no subprocess.
 */

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  /** URL the failure was observed for, already admitted by the URL policy. */
  readonly url: string | undefined;

  constructor(code: SafeFetchErrorCode, message: string, url?: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
    this.url = url;
  }
}

/** One redirect hop, retained so a capture's provenance is auditable. */
export interface SafeFetchRedirect {
  from: string;
  to: string;
  status: number;
}

export interface SafeFetchResponse {
  /** URL the caller asked for. */
  requestedUrl: string;
  /** URL the bytes were finally served from, after every redirect. */
  finalUrl: string;
  status: number;
  /** Media type with parameters stripped and lower-cased; `""` when absent. */
  mediaType: string;
  /** Exact observed bytes. */
  bytes: Buffer;
  byteLength: number;
  /** SHA-256 over the exact observed bytes, lowercase hex. */
  sha256: string;
  redirects: readonly SafeFetchRedirect[];
  /** RFC 3339 timestamp the response completed at. */
  retrievedAt: string;
}

/**
 * A wall-clock budget shared by every request in one logical operation, so a
 * registration cannot be stretched indefinitely by a host that answers each
 * individual request just inside its own timeout.
 */
export class OperationBudget {
  private readonly expiresAt: number;

  constructor(
    totalTimeoutMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.expiresAt = now() + totalTimeoutMs;
  }

  remainingMs(): number {
    return this.expiresAt - this.now();
  }

  assertRemaining(url?: string): void {
    if (this.remainingMs() <= 0) {
      throw new SafeFetchError("timeout", "The operation exceeded its total time budget.", url);
    }
  }
}

/** Node's socket lookup hook, narrowed to what this module needs. */
export type LookupFunction = (
  hostname: string,
  options: { family?: number | undefined; hints?: number | undefined; all?: boolean | undefined },
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | Array<{ address: string; family: number }>,
    family?: number,
  ) => void,
) => void;

export interface SafeFetchOptions {
  policy?: UrlSafetyPolicy;
  /** Hard cap on the bytes buffered for one response. */
  maxResponseBytes?: number;
  /** Maximum redirect hops. Every hop is re-admitted through the URL policy. */
  maxRedirects?: number;
  connectTimeoutMs?: number;
  /** Socket inactivity timeout while the body streams. */
  readTimeoutMs?: number;
  /** Budget for one whole operation; pass the same one to every related fetch. */
  budget?: OperationBudget;
  /** Total budget to create when `budget` is not supplied. */
  totalTimeoutMs?: number;
  /**
   * Media types the caller is willing to accept, without parameters. An empty
   * list accepts anything; a non-empty list is enforced fail-closed, including
   * against a missing `Content-Type`.
   */
  allowedMediaTypes?: readonly string[];
  /** Value sent as `Accept`. */
  accept?: string;
  userAgent?: string;
  /** Injectable resolver, so a test can simulate a hostile DNS answer. */
  lookup?: LookupFunction;
}

export const SAFE_FETCH_DEFAULTS = {
  maxResponseBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  connectTimeoutMs: 5_000,
  readTimeoutMs: 10_000,
  totalTimeoutMs: 30_000,
  userAgent: "open-review-atlas",
  accept: "*/*",
} as const;

function mediaTypeOf(response: IncomingMessage): string {
  const header = response.headers["content-type"];
  if (typeof header !== "string") return "";
  return header.split(";")[0]!.trim().toLowerCase();
}

/**
 * Wrap a resolver so every address it returns is classified before a socket is
 * opened. A resolver answer containing even one inadmissible address fails the
 * whole connection: filtering instead would leave the disallowed address
 * reachable through Node's happy-eyeballs failover.
 */
function guardedLookup(policy: ResolvedUrlSafetyPolicy, base: LookupFunction): LookupFunction {
  return (hostname, options, callback) => {
    base(hostname, { ...options, all: true }, (error, address) => {
      if (error) {
        callback(error, "");
        return;
      }
      const entries = (
        Array.isArray(address) ? address : [{ address: String(address), family: 4 }]
      ) as Array<{ address: string; family: number }>;
      if (entries.length === 0) {
        callback(dnsFailure("EAI_NODATA", "The host did not resolve."), "");
        return;
      }
      for (const entry of entries) {
        const addressClass: AddressClass | null = classifyIpAddress(entry.address);
        if (!isAddressClassAllowed(addressClass, policy)) {
          callback(
            dnsFailure(
              "ORATLAS_DESTINATION_NOT_PUBLIC",
              `The host resolves to ${
                addressClass === null ? "an unrecognised address" : describeAddressClass(addressClass)
              }.`,
            ),
            "",
          );
          return;
        }
      }
      if (options.all === true) {
        callback(null, entries);
        return;
      }
      const first = entries[0]!;
      callback(null, first.address, first.family);
    });
  };
}

function dnsFailure(code: string, message: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  return error;
}

interface HopResult {
  status: number;
  location: string | undefined;
  response: IncomingMessage;
}

/**
 * Retrieve one URL, following a bounded number of redirects and re-admitting
 * every hop through the URL policy.
 */
export async function safeFetch(
  requestedUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResponse> {
  const policy = resolveUrlSafetyPolicy(options.policy);
  const maxResponseBytes = options.maxResponseBytes ?? SAFE_FETCH_DEFAULTS.maxResponseBytes;
  const maxRedirects = options.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects;
  const connectTimeoutMs = options.connectTimeoutMs ?? SAFE_FETCH_DEFAULTS.connectTimeoutMs;
  const readTimeoutMs = options.readTimeoutMs ?? SAFE_FETCH_DEFAULTS.readTimeoutMs;
  const budget =
    options.budget ?? new OperationBudget(options.totalTimeoutMs ?? SAFE_FETCH_DEFAULTS.totalTimeoutMs);
  const lookup = guardedLookup(policy, options.lookup ?? (dnsLookup as unknown as LookupFunction));

  const admitted = assessExternalUrl(requestedUrl, policy);
  if (!admitted.ok) throw new SafeFetchError(admitted.code, admitted.reason, undefined);

  const redirects: SafeFetchRedirect[] = [];
  let current = admitted.url;

  for (let hop = 0; ; hop += 1) {
    budget.assertRemaining(current.href);
    const hop_ = await performHop(current, {
      policy,
      connectTimeoutMs,
      readTimeoutMs,
      budget,
      lookup,
      userAgent: options.userAgent ?? SAFE_FETCH_DEFAULTS.userAgent,
      accept: options.accept ?? SAFE_FETCH_DEFAULTS.accept,
      maxResponseBytes,
    });

    if (hop_.location !== undefined) {
      if (hop >= maxRedirects) {
        hop_.response.destroy();
        throw new SafeFetchError(
          "too-many-redirects",
          `The destination redirected more than ${maxRedirects} times.`,
          current.href,
        );
      }
      let next: URL;
      try {
        next = new URL(hop_.location, current);
      } catch {
        hop_.response.destroy();
        throw new SafeFetchError(
          "redirect-not-allowed",
          "The destination redirected to an unparseable location.",
          current.href,
        );
      }
      // Every hop is re-admitted from scratch. A public URL must not be able to
      // hand the fetcher a private, loopback or metadata destination.
      const nextAdmitted = assessExternalUrl(next.href, policy);
      if (!nextAdmitted.ok) {
        hop_.response.destroy();
        throw new SafeFetchError(
          "redirect-not-allowed",
          `The destination redirected to a URL that is not accepted: ${nextAdmitted.reason}`,
          current.href,
        );
      }
      hop_.response.destroy();
      redirects.push({ from: current.href, to: nextAdmitted.url.href, status: hop_.status });
      current = nextAdmitted.url;
      continue;
    }

    if (hop_.status < 200 || hop_.status > 299) {
      hop_.response.destroy();
      throw new SafeFetchError(
        "http-status",
        `The destination answered with HTTP ${hop_.status}.`,
        current.href,
      );
    }

    const mediaType = mediaTypeOf(hop_.response);
    const allowed = options.allowedMediaTypes ?? [];
    if (allowed.length > 0 && !allowed.includes(mediaType)) {
      hop_.response.destroy();
      throw new SafeFetchError(
        "content-type-not-allowed",
        mediaType === ""
          ? "The destination declared no content type."
          : `The destination declared an unexpected content type '${mediaType}'.`,
        current.href,
      );
    }

    const bytes = await readBounded(hop_.response, maxResponseBytes, budget, current.href);
    return {
      requestedUrl: admitted.url.href,
      finalUrl: current.href,
      status: hop_.status,
      mediaType,
      bytes,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      redirects,
      retrievedAt: new Date().toISOString(),
    };
  }
}

interface HopOptions {
  policy: ResolvedUrlSafetyPolicy;
  connectTimeoutMs: number;
  readTimeoutMs: number;
  budget: OperationBudget;
  lookup: LookupFunction;
  userAgent: string;
  accept: string;
  maxResponseBytes: number;
}

function performHop(url: URL, options: HopOptions): Promise<HopResult> {
  return new Promise<HopResult>((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      action();
    };

    const request = send(
      url,
      {
        method: "GET",
        lookup: options.lookup as never,
        // No cookies, no authorization, no caller-supplied headers: an external
        // publication never receives ORAtlas credentials or ambient state.
        headers: {
          accept: options.accept,
          "user-agent": options.userAgent,
          "accept-encoding": "identity",
        },
      },
      (response) => {
        clearTimeout(connectTimer);
        const status = response.statusCode ?? 0;
        const isRedirect = status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
        const rawLocation = response.headers.location;
        const location = isRedirect && typeof rawLocation === "string" ? rawLocation : undefined;
        if (isRedirect && location === undefined) {
          response.destroy();
          finish(() =>
            reject(
              new SafeFetchError(
                "redirect-not-allowed",
                "The destination sent a redirect without a location.",
                url.href,
              ),
            ),
          );
          return;
        }
        // Reject on the declared length before a byte of the body is buffered.
        const declared = Number(response.headers["content-length"]);
        if (
          location === undefined &&
          Number.isFinite(declared) &&
          declared > options.maxResponseBytes
        ) {
          response.destroy();
          finish(() =>
            reject(
              new SafeFetchError(
                "response-too-large",
                `The response exceeds the ${options.maxResponseBytes}-byte limit.`,
                url.href,
              ),
            ),
          );
          return;
        }
        finish(() => resolve({ status, location, response }));
      },
    );

    const connectTimer = setTimeout(() => {
      request.destroy(new SafeFetchError("timeout", "Connecting to the destination timed out.", url.href));
    }, Math.max(1, Math.min(options.connectTimeoutMs, options.budget.remainingMs())));

    request.setTimeout(Math.max(1, options.readTimeoutMs), () => {
      request.destroy(new SafeFetchError("timeout", "The destination stopped responding.", url.href));
    });

    request.on("error", (error) => {
      finish(() => reject(toSafeFetchError(error, url.href)));
    });
    request.end();
  });
}

function toSafeFetchError(error: unknown, url: string): SafeFetchError {
  if (error instanceof SafeFetchError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ORATLAS_DESTINATION_NOT_PUBLIC") {
    return new SafeFetchError(
      "destination-not-public",
      (error as Error).message,
      url,
    );
  }
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return new SafeFetchError("timeout", "The destination stopped responding.", url);
  }
  // Deliberately generic: a caller must not learn ORAtlas's DNS view or its
  // internal network topology from a failed registration.
  return new SafeFetchError("network-error", "The destination could not be retrieved.", url);
}

function readBounded(
  response: IncomingMessage,
  maxBytes: number,
  budget: OperationBudget,
  url: string,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (error: SafeFetchError) => {
      if (settled) return;
      settled = true;
      response.destroy();
      reject(error);
    };
    response.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.byteLength;
      if (total > maxBytes) {
        fail(
          new SafeFetchError(
            "response-too-large",
            `The response exceeds the ${maxBytes}-byte limit.`,
            url,
          ),
        );
        return;
      }
      if (budget.remainingMs() <= 0) {
        fail(new SafeFetchError("timeout", "The operation exceeded its total time budget.", url));
        return;
      }
      chunks.push(chunk);
    });
    response.on("aborted", () => {
      fail(new SafeFetchError("network-error", "The destination closed the response early.", url));
    });
    response.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(toSafeFetchError(error, url));
    });
    response.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, total));
    });
  });
}
