/** Repository-independent HTTP client for external scientific verification workers. */
export class VerifierApiClient {
  private leaseByRun = new Map<string, string>();

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async claim(runId: string, leaseSeconds = 300) {
    const result = await this.json(`/api/verification-runs/${encodeURIComponent(runId)}/claim`, {
      method: "POST",
      body: JSON.stringify({ leaseSeconds }),
    });
    if (typeof result.leaseToken !== "string")
      throw new Error("ORAtlas claim response omitted its one-time lease token.");
    this.leaseByRun.set(runId, result.leaseToken);
    return result;
  }

  getInput(runId: string) {
    return this.json(`/api/verification-runs/${encodeURIComponent(runId)}/input`, {}, runId);
  }

  async downloadSourceArtifact(
    runId: string,
    artifactId: string,
    expected: { sha256: string; byteLength: number; mediaType: string },
  ) {
    const response = await this.request(
      `/api/verification-runs/${encodeURIComponent(runId)}/source-artifacts/${encodeURIComponent(artifactId)}`,
      {},
      runId,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actualHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    if (
      bytes.byteLength !== expected.byteLength ||
      response.headers.get("content-type") !== expected.mediaType ||
      response.headers.get("x-oratlas-sha256") !== expected.sha256 ||
      actualHash !== expected.sha256
    )
      throw new Error("ORAtlas source artifact bytes do not match the frozen input metadata.");
    return bytes;
  }

  prepareArtifact(runId: string, input: unknown) {
    return this.json(
      `/api/verification-runs/${encodeURIComponent(runId)}/artifacts/prepare`,
      { method: "POST", body: JSON.stringify(input) },
      runId,
    );
  }

  async uploadArtifact(runId: string, artifactId: string, bytes: Uint8Array, mediaType: string) {
    return this.json(
      `/api/verification-artifacts/${encodeURIComponent(artifactId)}/content`,
      {
        method: "PUT",
        headers: { "content-type": mediaType, "content-length": String(bytes.byteLength) },
        body: Uint8Array.from(bytes).buffer,
      },
      runId,
      false,
    );
  }

  completeArtifact(runId: string, artifactId: string) {
    return this.json(
      `/api/verification-runs/${encodeURIComponent(runId)}/artifacts/complete`,
      { method: "POST", body: JSON.stringify({ artifactId }) },
      runId,
    );
  }

  submitFinding(runId: string, finding: unknown) {
    return this.json(
      `/api/verification-runs/${encodeURIComponent(runId)}/findings`,
      { method: "POST", body: JSON.stringify(finding) },
      runId,
    );
  }

  transition(runId: string, input: unknown) {
    return this.json(
      `/api/verification-runs/${encodeURIComponent(runId)}/transition`,
      { method: "POST", body: JSON.stringify(input) },
      runId,
    );
  }

  async getPublicRun(runId: string) {
    return this.publicJson(`/api/verification-runs/${encodeURIComponent(runId)}`);
  }

  async listPublicVersionVerifications(publicationVersionId: string) {
    return this.publicJson(
      `/api/publication-versions/${encodeURIComponent(publicationVersionId)}/verifications`,
    );
  }

  private async publicJson(path: string) {
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      headers: { accept: "application/json" },
    });
    if (!response.ok)
      throw new VerifierApiError(response.status, (await response.text()).slice(0, 2_000));
    return response.json() as Promise<Record<string, unknown>>;
  }

  private async request(path: string, init: RequestInit, runId: string) {
    const headers = new Headers(init.headers);
    const lease = this.leaseByRun.get(runId);
    if (!lease) throw new Error(`Run ${runId} has not been claimed by this client.`);
    headers.set("authorization", `Bearer ${this.token}`);
    headers.set("x-oratlas-verification-lease", lease);
    const response = await this.fetcher(new URL(path, this.baseUrl), { ...init, headers });
    if (!response.ok)
      throw new VerifierApiError(response.status, (await response.text()).slice(0, 2_000));
    return response;
  }

  private async json(path: string, init: RequestInit = {}, runId?: string, jsonBody = true) {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.token}`);
    headers.set("accept", "application/json");
    if (jsonBody && init.body != null && !headers.has("content-type"))
      headers.set("content-type", "application/json");
    if (runId) {
      const lease = this.leaseByRun.get(runId);
      if (!lease) throw new Error(`Run ${runId} has not been claimed by this client.`);
      headers.set("x-oratlas-verification-lease", lease);
    }
    const response = await this.fetcher(new URL(path, this.baseUrl), { ...init, headers });
    if (!response.ok)
      throw new VerifierApiError(response.status, (await response.text()).slice(0, 2_000));
    return response.json() as Promise<Record<string, unknown>>;
  }
}

/** Session-backed API client for the deliberately separate editor request operation. */
export class VerificationEditorApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async createRun(input: unknown) {
    const response = await this.fetcher(new URL("/api/verification-runs", this.baseUrl), {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(input),
      credentials: "include",
    });
    if (!response.ok)
      throw new VerifierApiError(response.status, (await response.text()).slice(0, 2_000));
    return response.json() as Promise<Record<string, unknown>>;
  }
}

export class VerifierApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(`ORAtlas verifier API returned ${status}.`);
    this.name = "VerifierApiError";
  }
}
