/** Framework- and repository-independent HTTP client available to every certifier. */
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
  async transitionRun(
    runId: string,
    transition: { status: "failed" | "cancelled"; reason: string },
  ) {
    return this.request(`/api/certification-runs/${encodeURIComponent(runId)}/transition`, {
      method: "POST",
      body: JSON.stringify(transition),
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
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.token}`);
    headers.set("content-type", "application/json");
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      ...init,
      headers,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new CertifierApiError(response.status, body.slice(0, 2_000));
    }
    return response.json();
  }
}

export class CertifierApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(`ORAtlas certifier API returned ${status}.`);
    this.name = "CertifierApiError";
  }
}
