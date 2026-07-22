/**
 * Provider-neutral, mockable DOI/Zenodo resolver. Real implementation performs
 * server-side HEAD/GET against doi.org and the public Zenodo API with explicit
 * timeouts. Tests inject a fake resolver so the suite never hits the network.
 */

export interface DoiResolution {
  /** True if doi.org resolves the DOI (2xx/3xx). */
  resolves: boolean;
  resolvedUrl?: string;
  status: number;
}

export interface ZenodoRecord {
  recordId: string;
  conceptRecordId?: string;
  conceptDoi?: string;
  title?: string;
  creators: string[];
  publicationDate?: string;
  /** Related identifiers / metadata URLs (used for repository matching). */
  relatedUrls: string[];
  versionTag?: string;
}

export interface DoiResolver {
  resolveDoi(doi: string): Promise<DoiResolution>;
  fetchZenodoRecord(recordId: string): Promise<ZenodoRecord | null>;
}

export interface FetchResolverOptions {
  timeoutMs?: number;
  /** Maximum decoded response bytes buffered for one Zenodo metadata response. */
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
  zenodoApiBase?: string;
}

const ZENODO_API_BASE = "https://zenodo.org/api";
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RESOLUTION_URL_LENGTH = 2048;

function isUnsafeIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isUnsafeIpv6(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "::" ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    /^fe[89ab]/.test(host) ||
    /^fe[c-f]/.test(host) ||
    host.startsWith("ff") ||
    host.startsWith("::ffff:")
  );
}

/** Retain only bounded, public HTTPS redirect targets for reports and callers. */
export function safeDoiResolutionUrl(value: string | null | undefined): string | undefined {
  if (!value || value.length > MAX_RESOLUTION_URL_LENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    isUnsafeIpv4(hostname) ||
    (hostname.includes(":") && isUnsafeIpv6(hostname))
  ) {
    return undefined;
  }
  return url.href;
}

function validateZenodoApiBase(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Zenodo API base must be the canonical https://zenodo.org/api URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "zenodo.org" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname.replace(/\/+$/, "") !== "/api" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Zenodo API base must be the canonical https://zenodo.org/api URL.");
  }
  return ZENODO_API_BASE;
}

async function readJsonBounded(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      await response.body?.cancel("declared response byte limit exceeded");
      throw new Error(`Response exceeds the ${maxBytes}-byte limit.`);
    }
  }

  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("response byte limit exceeded");
        throw new Error(`Response exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export function createFetchResolver(options: FetchResolverOptions = {}): DoiResolver {
  const {
    timeoutMs = 10_000,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    fetchImpl = fetch,
    zenodoApiBase = ZENODO_API_BASE,
  } = options;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new Error("Zenodo response byte limit must be a positive safe integer.");
  }
  const validatedZenodoApiBase = validateZenodoApiBase(zenodoApiBase);

  async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fn(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async resolveDoi(doi: string): Promise<DoiResolution> {
      return withTimeout(async (signal) => {
        try {
          const res = await fetchImpl(`https://doi.org/${encodeURIComponent(doi)}`, {
            method: "HEAD",
            redirect: "manual",
            signal,
            headers: { "User-Agent": "open-review-atlas" },
          });
          const resolves = res.status >= 200 && res.status < 400;
          return {
            resolves,
            resolvedUrl: safeDoiResolutionUrl(res.headers.get("location")),
            status: res.status,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { resolves: false, status: 0, resolvedUrl: undefined, ...{ error: message } };
        }
      });
    },

    async fetchZenodoRecord(recordId: string): Promise<ZenodoRecord | null> {
      return withTimeout(async (signal) => {
        try {
          const res = await fetchImpl(
            `${validatedZenodoApiBase}/records/${encodeURIComponent(recordId)}`,
            {
              signal,
              redirect: "error",
              headers: { Accept: "application/json", "User-Agent": "open-review-atlas" },
            },
          );
          if (!res.ok) return null;
          const json = (await readJsonBounded(res, maxResponseBytes)) as Record<string, unknown>;
          return parseZenodoRecord(json);
        } catch {
          return null;
        }
      });
    },
  };
}

/** Parse a Zenodo API record payload into our normalized shape. */
export function parseZenodoRecord(json: Record<string, unknown>): ZenodoRecord {
  const metadata = (json.metadata ?? {}) as Record<string, unknown>;
  const conceptrecid = json.conceptrecid;
  const conceptDoi =
    typeof metadata.conceptdoi === "string"
      ? metadata.conceptdoi
      : typeof json.conceptdoi === "string"
        ? (json.conceptdoi as string)
        : undefined;

  const creators = Array.isArray(metadata.creators)
    ? (metadata.creators as Array<Record<string, unknown>>)
        .map((c) => (typeof c.name === "string" ? c.name : undefined))
        .filter((v): v is string => Boolean(v))
    : [];

  const relatedUrls: string[] = [];
  if (Array.isArray(metadata.related_identifiers)) {
    for (const r of metadata.related_identifiers as Array<Record<string, unknown>>) {
      if (typeof r.identifier === "string") relatedUrls.push(r.identifier);
    }
  }

  return {
    recordId: String(json.id ?? json.recid ?? ""),
    conceptRecordId: conceptrecid !== undefined ? String(conceptrecid) : undefined,
    conceptDoi,
    title: typeof metadata.title === "string" ? metadata.title : undefined,
    creators,
    publicationDate:
      typeof metadata.publication_date === "string" ? metadata.publication_date : undefined,
    relatedUrls,
    versionTag: typeof metadata.version === "string" ? metadata.version : undefined,
  };
}
