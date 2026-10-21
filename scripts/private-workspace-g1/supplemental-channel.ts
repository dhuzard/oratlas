import { createHash } from "node:crypto";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import {
  comparePairedCaptures,
  compareWithGolden,
  goldenCandidate,
  validateCapture,
} from "./compare.js";
import type { Scenario } from "./scenarios.js";

/** Compiled descriptors only. These never accept an arbitrary spec, SQL path or program from env. */
export type SupplementalProgram = {
  readonly name: string;
  readonly spec: string;
  readonly outVariable: string;
  readonly scenarios: readonly Scenario[];
  readonly fixture?: string;
  readonly addedRows: Readonly<Record<string, number>>;
  readonly stateSuffix: string;
};
export type SupplementalEvidence = { readonly capture: unknown; readonly state: unknown };
export type SupplementalGolden = {
  readonly protocol: "oratlas.g1.supplemental/0.1";
  readonly program: string;
  readonly http: unknown;
  readonly stateSha256: string;
  readonly review: string;
};
export function supplementalStateDigest(state: unknown): string {
  return createHash("sha256").update(canonicalJson(state)).digest("hex");
}
export function supplementalCandidate(
  program: SupplementalProgram,
  evidence: SupplementalEvidence,
  review: string,
): SupplementalGolden {
  return {
    protocol: "oratlas.g1.supplemental/0.1",
    program: program.name,
    http: goldenCandidate(evidence.capture, review),
    stateSha256: supplementalStateDigest(evidence.state),
    review,
  };
}
/** State files retain complete native rows; no time, identifier or field is excluded here. */
export function supplementalPairProblems(
  before: SupplementalEvidence,
  after: SupplementalEvidence,
): string[] {
  return [
    ...comparePairedCaptures(before.capture, after.capture),
    ...(supplementalStateDigest(before.state) === supplementalStateDigest(after.state)
      ? []
      : ["Complete supplemental state evidence differs"]),
  ];
}
export function supplementalGoldenProblems(
  program: SupplementalProgram,
  evidence: SupplementalEvidence,
  golden: unknown,
): string[] {
  const problems = validateCapture(evidence.capture, program.scenarios);
  if (
    !golden ||
    typeof golden !== "object" ||
    !("protocol" in golden) ||
    golden.protocol !== "oratlas.g1.supplemental/0.1" ||
    !("program" in golden) ||
    golden.program !== program.name ||
    !("http" in golden) ||
    !("stateSha256" in golden) ||
    !("review" in golden) ||
    typeof golden.review !== "string" ||
    golden.review.length === 0
  )
    return [...problems, "Invalid reviewed supplemental golden"];
  return [
    ...problems,
    ...compareWithGolden(evidence.capture, golden.http, program.scenarios),
    ...(supplementalStateDigest(evidence.state) === golden.stateSha256
      ? []
      : ["Complete supplemental state differs from reviewed golden"]),
  ];
}
/** Extra fixtures must declare every count change, including unexpected writes to existing tables. */
export function supplementalCountsProblems(
  base: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
  added: Readonly<Record<string, number>>,
): string[] {
  const tables = new Set([...Object.keys(base), ...Object.keys(actual), ...Object.keys(added)]);
  return [...tables].sort().flatMap((table) => {
    const delta = added[table] ?? 0;
    return Number.isSafeInteger(delta) &&
      delta >= 0 &&
      table in base &&
      table in actual &&
      actual[table] === base[table]! + delta
      ? []
      : [`Supplemental row count differs: ${table}`];
  });
}
