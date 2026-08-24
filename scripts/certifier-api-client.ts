/**
 * API-only reference client for an external certifier. This file intentionally
 * has no ORAtlas package, Prisma, database, or repository-internal imports.
 */
export class CertifierApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async createRun(input: {
    publicationVersionId: string;
    certificationProtocolId: string;
    assessmentMode: "human" | "ai" | "hybrid";
    idempotencyKey: string;
    externalRunReference?: string;
  }) {
    return this.request("/api/certification-runs", { method: "POST", body: JSON.stringify(input) });
  }
  async getRun(runId: string) {
    return this.request(`/api/certification-runs/${encodeURIComponent(runId)}`);
  }
  async getInput(runId: string) {
    return this.request(`/api/certification-runs/${encodeURIComponent(runId)}/input`);
  }
  async submitResult(runId: string, result: unknown) {
    return this.request(`/api/certification-runs/${encodeURIComponent(runId)}/result`, {
      method: "POST",
      body: JSON.stringify(result),
    });
  }
  async listPublicResults(publicationVersionId: string) {
    const response = await this.fetcher(
      new URL(
        `/api/publication-versions/${encodeURIComponent(publicationVersionId)}/certifications`,
        this.baseUrl,
      ),
    );
    if (!response.ok) throw new Error(`ORAtlas public API returned ${response.status}.`);
    return response.json();
  }
  private async request(path: string, init: RequestInit = {}) {
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`ORAtlas certifier API returned ${response.status}.`);
    return response.json();
  }
}
