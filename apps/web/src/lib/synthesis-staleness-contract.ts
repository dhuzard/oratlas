export const SYNTHESIS_STALENESS_SCAN_LIMIT = 100;
export const SYNTHESIS_STALENESS_AFFECTED_REFERENCE_LIMIT = 100;
export const SYNTHESIS_STALENESS_SERIALIZABLE_ATTEMPTS = 3;

export class SynthesisStalenessError extends Error {
  constructor(
    message: string,
    readonly code: "bad-request" | "not-found" | "conflict" | "forbidden" = "bad-request",
  ) {
    super(message);
    this.name = "SynthesisStalenessError";
  }
}
