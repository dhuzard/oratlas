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
  fetchImpl?: typeof fetch;
  zenodoApiBase?: string;
}

export function createFetchResolver(options: FetchResolverOptions = {}): DoiResolver {
  const {
    timeoutMs = 10_000,
    fetchImpl = fetch,
    zenodoApiBase = "https://zenodo.org/api",
  } = options;

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
            resolvedUrl: res.headers.get("location") ?? undefined,
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
          const res = await fetchImpl(`${zenodoApiBase}/records/${encodeURIComponent(recordId)}`, {
            signal,
            headers: { Accept: "application/json", "User-Agent": "open-review-atlas" },
          });
          if (!res.ok) return null;
          const json = (await res.json()) as Record<string, unknown>;
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
