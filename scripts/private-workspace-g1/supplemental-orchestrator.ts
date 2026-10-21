import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { G1ChildEnv, G1HarnessDeps } from "./orchestrator.js";
import type { G1Connection } from "./target.js";
import { validateCapture } from "./compare.js";
import {
  supplementalCandidate,
  supplementalCountsProblems,
  supplementalCountsSql,
  supplementalGoldenProblems,
  supplementalPairProblems,
  type SupplementalEvidence,
  type SupplementalProgram,
} from "./supplemental-channel.js";

export type SupplementalEffects = {
  readonly programs: readonly SupplementalProgram[];
  readonly labels: readonly string[];
  readonly directory: string;
  readonly evidenceDir: string;
  readonly inventoryTables: readonly string[];
  readonly admin: G1Connection;
  readonly secrets: readonly string[];
  readonly deps: G1HarnessDeps;
  readonly reset: (label: string) => Promise<void>;
  readonly childEnv: (
    outVariable: string,
    out: string,
    extra: Record<string, string>,
  ) => G1ChildEnv;
  readonly record: (step: string, ok: boolean, detail?: unknown) => void;
};
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
/** Four independently reset captures, always dispatched through a compiled program descriptor. */
export function supplementalChannels(effects: SupplementalEffects) {
  const { programs, labels, directory, evidenceDir, deps, admin, secrets } = effects;
  const record = (step: string, ok: boolean, detail?: unknown) => {
    effects.record(step, ok, detail);
    if (!ok) throw new Error("Supplemental check failed");
  };
  const captures = new Map<string, Map<string, SupplementalEvidence>>();
  for (const program of programs) {
    if (!/^[a-z][a-z0-9-]{0,39}$/u.test(program.name) || captures.has(program.name))
      throw new Error("Invalid compiled supplemental program name");
    captures.set(program.name, new Map());
  }
  const countsSql = supplementalCountsSql(effects.inventoryTables);
  return {
    async capture(label: string): Promise<void> {
      if (!labels.includes(label)) throw new Error("Invalid supplemental capture label");
      for (const program of programs) {
        await effects.reset(`${label} ${program.name} capture`);
        const before = await deps.queryJson<Record<string, number>>(admin, countsSql);
        for (const fixture of program.fixtures ?? [])
          await deps.runPsql(admin, readFileSync(join(directory, fixture), "utf8"), {
            singleTransaction: true,
            secrets,
          });
        const after = await deps.queryJson<Record<string, number>>(admin, countsSql);
        const countProblems = supplementalCountsProblems(before, after, program.addedRows);
        record(
          `${label} ${program.name} fixture deltas match all recorded tables`,
          countProblems.length === 0,
          countProblems,
        );
        const out = join(evidenceDir, `${program.name}-${label}.json`);
        record(
          `${label} ${program.name}: fresh restricted handler child`,
          await deps.runSpec(
            program.spec,
            effects.childEnv(program.outVariable, out, { G1_CAPTURE_LABEL: label }),
            join(evidenceDir, `${program.name}-${label}.log`),
            secrets,
          ),
        );
        // A failed or missing child never supplies passed evidence. No fallback or empty sidecar.
        const evidence: SupplementalEvidence = {
          capture: read(out),
          state: read(out + program.stateSuffix),
        };
        const statePresent =
          evidence.state !== null &&
          typeof evidence.state === "object" &&
          !Array.isArray(evidence.state) &&
          Object.keys(evidence.state).length > 0;
        const problems = validateCapture(evidence.capture, program.scenarios);
        record(
          `${label} ${program.name} has complete child state and reviewed outcomes`,
          statePresent && problems.length === 0,
          problems,
        );
        captures.get(program.name)!.set(label, evidence);
      }
    },
    compare(): void {
      // Preserve every candidate for one independent review, even when the first golden is absent.
      for (const program of programs) {
        const reference = captures.get(program.name)!.get(labels[0]!);
        if (!reference || labels.some((label) => !captures.get(program.name)!.has(label)))
          throw new Error("Incomplete supplemental capture set");
        const candidate = supplementalCandidate(
          program,
          reference,
          "CANDIDATE — independent review required; never accepted automatically",
        );
        writeFileSync(
          join(evidenceDir, `${program.name}-golden-candidate.json`),
          JSON.stringify(candidate, null, 2) + "\n",
          { mode: 0o600 },
        );
      }
      for (const program of programs) {
        const items = captures.get(program.name)!;
        const reference = items.get(labels[0]!)!;
        if (!reference || labels.some((label) => !items.has(label)))
          throw new Error("Incomplete supplemental capture set");
        for (const label of labels.slice(1)) {
          const problems = supplementalPairProblems(reference, items.get(label)!);
          record(
            `${program.name} baseline and ${label} HTTP and complete state identical`,
            problems.length === 0,
            problems,
          );
        }
        const goldenPath = join(directory, "baselines", `${program.name}.golden.json`);
        record(`${program.name} independently reviewed golden present`, existsSync(goldenPath));
        const golden = read(goldenPath);
        const problems = labels.flatMap((label) =>
          supplementalGoldenProblems(program, items.get(label)!, golden).map(
            (problem) => `${label}: ${problem}`,
          ),
        );
        record(
          `${program.name} captures and full state match reviewed golden`,
          problems.length === 0,
          problems,
        );
      }
    },
  };
}
