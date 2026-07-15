import { createHash } from "node:crypto";
import {
  normalizedProtocolSchema,
  observedReviewSchema,
  PROTOCOL_CATEGORIES,
  protocolDriftProposalSchema,
  type NormalizedProtocol,
  type ObservedReview,
  type ProtocolCategory,
  type ProtocolDriftKind,
  type ProtocolDriftProposal,
  type ProtocolEvidence,
} from "./contracts.js";

export const PROTOCOL_COMPARATOR_VERSION = "1.0.0";

/**
 * Exact, deterministic comparison. It makes no semantic or intent inference:
 * differences are neutral proposals for a human editor to reconcile.
 */
export function compareProtocolToReview(
  protocolInput: NormalizedProtocol,
  observedInput: ObservedReview,
): ProtocolDriftProposal[] {
  const protocol = normalizedProtocolSchema.parse(protocolInput);
  const observed = observedReviewSchema.parse(observedInput);
  const proposals: ProtocolDriftProposal[] = [];
  for (const category of PROTOCOL_CATEGORIES) {
    const registered = dedupe(protocol.fields[category]);
    const reported = dedupe(observed.fields[category]);
    const registeredKeys = registered.map((entry) => normalizeText(entry.value));
    const reportedKeys = reported.map((entry) => normalizeText(entry.value));
    if (sameStringSet(registeredKeys, reportedKeys)) continue;
    if (
      protocol.source.registry === "clinicaltrials-gov" &&
      category === "analysis-plan" &&
      registered.length === 0
    ) {
      // The v2 adapter has no statistical-analysis-plan field. Study design
      // metadata is preserved separately and absence is not interpreted.
      continue;
    }
    const kind: ProtocolDriftKind =
      registered.length > 0 && reported.length === 0
        ? "not-described-in-review"
        : registered.length === 0 && reported.length > 0
          ? "not-registered"
          : "content-differs";
    const identity = canonical({
      comparatorVersion: PROTOCOL_COMPARATOR_VERSION,
      source: {
        registry: protocol.source.registry,
        sourceId: protocol.source.sourceId,
        sourceVersion: protocol.source.sourceVersion,
      },
      reviewVersionId: observed.reviewVersionId,
      targetKey: observed.targetKey,
      category,
      kind,
      registered: registeredKeys,
      observed: reportedKeys,
    });
    proposals.push(
      protocolDriftProposalSchema.parse({
        id: `pdp_${createHash("sha256").update(identity).digest("hex")}`,
        category,
        kind,
        registered,
        observed: reported,
        rationale: neutralRationale(category, kind),
        comparatorVersion: PROTOCOL_COMPARATOR_VERSION,
      }),
    );
  }
  return proposals;
}

function dedupe(values: ProtocolEvidence[]): ProtocolEvidence[] {
  const byNormalizedValue = new Map<string, ProtocolEvidence>();
  for (const entry of values) {
    const key = normalizeText(entry.value);
    const existing = byNormalizedValue.get(key);
    if (!existing || compareText(entry.sourcePointer, existing.sourcePointer) < 0) {
      byNormalizedValue.set(key, entry);
    }
  }
  return [...byNormalizedValue.values()].sort((a, b) =>
    compareText(normalizeText(a.value), normalizeText(b.value)),
  );
}

/** Locale-independent UTF-16 ordering keeps proposal identities stable across runners. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function sameStringSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function neutralRationale(category: ProtocolCategory, kind: ProtocolDriftKind): string {
  const label = category.replace("-", " ");
  const detail =
    kind === "not-described-in-review"
      ? `the registration describes ${label}, while the review has no structured ${label} scope`
      : kind === "not-registered"
        ? `the review describes ${label}, while the registration adapter found no structured ${label} entry`
        : `the registration and the review contain different structured ${label} descriptions`;
  return (
    `Human review requested: ${detail}. ` +
    "Confirm whether this reflects an intended protocol update, a reporting choice, or a metadata gap."
  );
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}
