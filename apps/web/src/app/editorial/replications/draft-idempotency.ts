import { canonicalJson } from "@oratlas/contracts/canonical-json";

export interface DraftRequestIdentity {
  key: string;
  canonicalPayload: string;
}

export type DraftRequestOutcome =
  { kind: "success" } | { kind: "transport-error" } | { kind: "http-error"; status: number };

/** Bind one request key to exactly one canonical draft payload. */
export function getOrCreateDraftRequestIdentity(
  current: DraftRequestIdentity | null,
  payload: unknown,
  create: () => string,
): DraftRequestIdentity {
  const canonicalPayload = canonicalJson(payload);
  return current?.canonicalPayload === canonicalPayload
    ? current
    : { key: create(), canonicalPayload };
}

/**
 * A transport failure or 5xx may have happened after commit, so retain the
 * identity for an identical replay. Definitive responses cannot need replay.
 */
export function settleDraftRequestIdentity(
  identity: DraftRequestIdentity,
  outcome: DraftRequestOutcome,
): DraftRequestIdentity | null {
  return outcome.kind === "transport-error" ||
    (outcome.kind === "http-error" && outcome.status >= 500)
    ? identity
    : null;
}
