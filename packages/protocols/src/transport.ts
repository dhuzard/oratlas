/** Injectable read-only transport; tests use fixtures and never perform networking. */
export interface ProtocolTransport {
  getJson(url: string): Promise<{
    body: unknown;
    fetchedAt: string;
    /** Exact ETag, Last-Modified, API data version, or immutable response version. */
    sourceVersion: string;
  }>;
}

export class ProtocolRegistryClient {
  constructor(private readonly transport: ProtocolTransport) {}

  async fetchOsfRegistration(id: string) {
    return this.transport.getJson(`https://api.osf.io/v2/registrations/${encodeURIComponent(id)}/`);
  }

  async fetchClinicalTrial(nctId: string) {
    return this.transport.getJson(
      `https://clinicaltrials.gov/api/v2/studies/${encodeURIComponent(nctId)}`,
    );
  }
}
