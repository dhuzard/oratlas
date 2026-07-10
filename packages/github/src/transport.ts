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
  baseUrl?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

const API_BASE = "https://api.github.com";

/** Real transport over the GitHub REST API. Server-side only. */
export function createFetchTransport(options: FetchTransportOptions = {}): GithubTransport {
  const {
    token,
    timeoutMs = 10_000,
    baseUrl = API_BASE,
    userAgent = "open-review-atlas",
    fetchImpl = fetch,
  } = options;

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
        const res = await fetchImpl(`${baseUrl}${path}`, {
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
        const text = await res.text();
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
