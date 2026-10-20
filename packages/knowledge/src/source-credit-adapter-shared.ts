import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CREDIT_ROLE_LABELS,
  SOURCE_CREDIT_OBSERVATIONS_V2_VERSION,
  SOURCE_CREDIT_PRODUCER_PINS,
  canonicalJson,
  sourceCreditObservationsV2Schema,
  type CreditRole,
  type SourceCreditObservationsV2,
} from "@oratlas/contracts";

export class SourceCreditAdapterError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SourceCreditAdapterError";
  }
}

export const digest = (bytes: string): string =>
  "sha256:" + createHash("sha256").update(bytes, "utf8").digest("hex");

export const shaSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const looseObject = z.record(z.unknown());
/** Adapter bound: every carried source string must fit the neutral contract. */
export const text = z.string().min(1).max(500);

export const MAXIMUM_SOURCE_BYTES = 3_000_000;

export function parseSource(
  raw: string,
  maximumBytes = MAXIMUM_SOURCE_BYTES,
): Record<string, unknown> {
  if (Buffer.byteLength(raw, "utf8") > maximumBytes)
    throw new SourceCreditAdapterError("source-oversize");
  try {
    const parsed: unknown = JSON.parse(raw);
    return looseObject.parse(parsed);
  } catch {
    throw new SourceCreditAdapterError("source-invalid-json");
  }
}

export function parseNative<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new SourceCreditAdapterError("source-schema-incompatible");
  return parsed.data;
}

export function verifyRosterdigest(data: Record<string, unknown>): void {
  const observed = parseNative(
    z.object({
      digest: z.object({
        algorithm: z.literal("sha256"),
        value: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
    }),
    data,
  );
  const { digest: _digest, ...body } = data;
  if (digest(canonicalJson(body)) !== "sha256:" + observed.digest.value) {
    throw new SourceCreditAdapterError("roster-digest-mismatch");
  }
}

export function parseJsonl(raw: string): Record<string, unknown>[] {
  try {
    if (Buffer.byteLength(raw, "utf8") > MAXIMUM_SOURCE_BYTES) throw Error();
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => looseObject.parse(JSON.parse(line)));
  } catch {
    throw new SourceCreditAdapterError("packet-invalid-jsonl");
  }
}

type Producer = SourceCreditObservationsV2["producer"];

export type Draft = SourceCreditObservationsV2;

export function startDraft(
  producer: Producer,
  sourceId: string,
  raw: string,
  sourceDocument: SourceCreditObservationsV2["sourceDocument"],
): Draft {
  const pin = SOURCE_CREDIT_PRODUCER_PINS[producer];
  return {
    schemaVersion: SOURCE_CREDIT_OBSERVATIONS_V2_VERSION,
    producer,
    producerContract: pin.contract,
    sourceContractPinnedCommit: pin.commit,
    sourceId,
    sourceDocumentSha256: digest(raw),
    visibility: "private-adapter-output",
    accessEffect: "none",
    accountVerification: "not-performed",
    sourceDocument,
    assertions: [],
    evidence: [],
    production: [],
    sourceLegacyRoleLabels: [],
    candidateContacts: [],
    candidateCreditClaims: [],
    report: {
      accepted: 0,
      withheld: 0,
      unmappable: 0,
      reasonCodes: [],
      legacyRoleLabels: { preserved: 0, sourceUnmappable: 0, sourceCreditIneligible: 0 },
      producerDeclaredOmissions: null,
      omittedSourceFields: [],
    },
  };
}

/**
 * Collision-free observation id: the producer prefix, a channel, and the
 * SHA-256 of the canonical JSON tuple of native identifiers. Joining native
 * keys with `:` is ambiguous (ORCID keys and CRT finding ids may contain `:`),
 * and an array index breaks permutation invariance.
 */
export function tupleId(
  producer: Producer,
  channel: string,
  parts: readonly (string | number | null)[],
): string {
  return (
    SOURCE_CREDIT_PRODUCER_PINS[producer].idPrefix +
    channel +
    ":" +
    digest(canonicalJson([...parts])).slice(7)
  );
}

const foldRole = (value: string): string =>
  value
    .normalize("NFC")
    .replace(/[\u2010-\u2015\u2212]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

const ROLE_LOOKUP: ReadonlyMap<string, CreditRole> = new Map(
  (Object.entries(CREDIT_ROLE_LABELS) as [CreditRole, string][]).flatMap(([slug, label]) => [
    [slug, slug],
    [foldRole(label), slug],
  ]),
);

/**
 * Deterministic CRediT normalization: only an exact canonical ID or display
 * label (modulo case, whitespace and dash style) maps. Anything else is `null`
 * and must be reported as unmappable; roles are never inferred.
 */
export function mapCreditRole(value: string): CreditRole | null {
  return ROLE_LOOKUP.get(foldRole(value)) ?? null;
}

export const sortedStrings = (values: readonly string[]): string[] =>
  [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const byObservationId = (a: { observationId: string }, b: { observationId: string }) =>
  a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0;

export function finishDraft(draft: Draft): SourceCreditObservationsV2 {
  const report = draft.report;
  report.accepted =
    draft.assertions.length +
    draft.evidence.length +
    draft.production.length +
    draft.candidateContacts.length +
    draft.candidateCreditClaims.length;
  const labels = draft.sourceLegacyRoleLabels;
  report.legacyRoleLabels = {
    preserved: labels.length,
    sourceUnmappable: labels.filter((label) => label.sourceMapping === "unmappable").length,
    sourceCreditIneligible: labels.filter((label) => !label.sourceCreditEligible).length,
  };
  report.reasonCodes = sortedStrings([...new Set(report.reasonCodes)]);
  report.omittedSourceFields = sortedStrings([...new Set(report.omittedSourceFields)]);
  draft.assertions.sort(byObservationId);
  draft.evidence.sort(byObservationId);
  draft.production.sort(byObservationId);
  draft.sourceLegacyRoleLabels.sort(byObservationId);
  draft.candidateContacts.sort(byObservationId);
  draft.candidateCreditClaims.sort(byObservationId);
  // Zod issues can echo rejected input values; surface only a stable code.
  const parsed = sourceCreditObservationsV2Schema.safeParse(draft);
  if (!parsed.success) throw new SourceCreditAdapterError("normalized-output-invalid");
  return parsed.data;
}

export function uniqueOrThrow(items: string[], code = "conflicting-source-identity"): void {
  if (new Set(items).size !== items.length) throw new SourceCreditAdapterError(code);
}

/** Source-native `not-available` sentinel becomes null; nothing else is rewritten. */
export const naToNull = (value: string): string | null =>
  value === "not-available" ? null : value;

export function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = sortedStrings(left);
  const b = sortedStrings(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
