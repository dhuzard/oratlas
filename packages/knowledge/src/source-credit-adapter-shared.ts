import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalJson,
  sourceCreditObservationsSchema,
  type SourceCreditObservations,
} from "@oratlas/contracts";

export class SourceCreditAdapterError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SourceCreditAdapterError";
  }
}

export const digest = (bytes: string): string =>
  "sha256:" + createHash("sha256").update(bytes, "utf8").digest("hex");

export const opaque = z.string().min(1).max(1000);
export const shaSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const looseObject = z.record(z.unknown());

export function parseSource(raw: string, maximumBytes = 3_000_000): Record<string, unknown> {
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
    if (raw.length > 3_000_000) throw Error();
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => looseObject.parse(JSON.parse(line)));
  } catch {
    throw new SourceCreditAdapterError("packet-invalid-jsonl");
  }
}

export type Draft = Omit<SourceCreditObservations, "report"> & {
  report: SourceCreditObservations["report"];
};

export function startDraft(
  producer: SourceCreditObservations["producer"],
  contract: string,
  commit: string,
  id: string,
  raw: string,
): Draft {
  return {
    schemaVersion: "oratlas.source-credit-observations/0.1.0",
    producer,
    producerContract: contract,
    producerCommit: commit,
    sourceId: id,
    sourceDocumentSha256: digest(raw),
    visibility: "private-adapter-output",
    accessEffect: "none",
    accountVerification: "not-performed",
    assertions: [],
    evidence: [],
    production: [],
    candidateContacts: [],
    report: { accepted: 0, withheld: 0, unmappable: 0, reasonCodes: [] },
  };
}

export function finishDraft(draft: Draft): SourceCreditObservations {
  draft.report.accepted =
    draft.assertions.length +
    draft.evidence.length +
    draft.production.length +
    draft.candidateContacts.length;
  draft.report.reasonCodes = [...new Set(draft.report.reasonCodes)].sort();
  for (const field of ["assertions", "evidence", "production", "candidateContacts"] as const) {
    draft[field].sort((a, b) => a.observationId.localeCompare(b.observationId, "en"));
  }
  return sourceCreditObservationsSchema.parse(draft);
}

export function uniqueOrThrow(items: string[], code = "conflicting-source-identity"): void {
  if (new Set(items).size !== items.length) throw new SourceCreditAdapterError(code);
}

export function isoOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "not-available" && value.length > 0 ? value : null;
}

export function arrayEq(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}
