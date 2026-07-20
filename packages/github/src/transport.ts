/**
 * Minimal, mockable GitHub REST transport. Only the canonical API host is
 * ever contacted; every request carries an explicit timeout. Tests inject a
 * fake transport so the suite never touches the network (spec §21).
 */
export interface GithubResponse {
  status: number;
  ok: boolean;
  json: unknown;
  /** Selected response headers (lower-cased keys), e.g. rate-limit info. */
  headers: Record<string, string>;
}

export interface GithubTransport {
  request(path: string, init?: { rawText?: boolean }): Promise<GithubResponse>;
}

export interface FetchTransportOptions {
  token?: string;
  timeoutMs?: number;
  /** Maximum decoded response bytes buffered for any single API request. */
  maxResponseBytes?: number;
  baseUrl?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

const API_BASE = "https://api.github.com";
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

function validateApiBase(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("GitHub API base must be the canonical https://api.github.com origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "api.github.com" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("GitHub API base must be the canonical https://api.github.com origin.");
  }
  return API_BASE;
}

async function readTextBounded(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      await response.body?.cancel("declared response byte limit exceeded");
      throw new Error(`Response exceeds the ${maxBytes}-byte limit.`);
    }
  }

  if (!response.body) return "";
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
  return new TextDecoder().decode(bytes);
}

/** Real transport over the GitHub REST API. Server-side only. */
export function createFetchTransport(options: FetchTransportOptions = {}): GithubTransport {
  const {
    token,
    timeoutMs = 10_000,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    baseUrl = API_BASE,
    userAgent = "open-review-atlas",
    fetchImpl = fetch,
  } = options;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new Error("GitHub response byte limit must be a positive safe integer.");
  }
  const validatedBaseUrl = validateApiBase(baseUrl);

  return {
    async request(path: string): Promise<GithubResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": userAgent,
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      try {
        const res = await fetchImpl(`${validatedBaseUrl}${path}`, {
          headers,
          signal: controller.signal,
          redirect: "error", // never follow redirects to unsafe hosts
        });
        const outHeaders: Record<string, string> = {};
        for (const key of ["x-ratelimit-remaining", "x-ratelimit-reset", "link"]) {
          const v = res.headers.get(key);
          if (v) outHeaders[key] = v;
        }
        let json: unknown = null;
        const text = await readTextBounded(res, maxResponseBytes);
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = text;
          }
        }
        return { status: res.status, ok: res.ok, json, headers: outHeaders };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          status: 0,
          ok: false,
          json: { message: `Request failed: ${message}` },
          headers: {},
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
