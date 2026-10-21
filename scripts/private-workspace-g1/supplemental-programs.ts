import { DETERMINISTIC_POST_PROGRAM } from "./deterministic-post-scenarios.js";
import { WORKER_ARTIFACT_PROGRAM } from "./worker-artifact-scenarios.js";
import { CERTIFIER_REPLAY_PROGRAM } from "./certifier-replay-scenarios.js";
import {
  workerReadScenarios,
  WORKER_READ_FIXTURE_DELTAS,
  WORKER_READ_FIXTURE_FILES,
} from "./worker-read-scenarios.js";
import { KNOWN_MUTATION_SCENARIOS } from "./known-mutation-scenarios.js";
import { SYNTHESIS_SCENARIOS } from "./synthesis-scenarios.js";
import { SYNTHESIS_FIXTURE_COUNTS } from "./synthesis-routes.js";
import type { SupplementalProgram } from "./supplemental-channel.js";

/** Fixed catalog: each program has its own reset, sidecar and independently reviewed golden. */
export const SUPPLEMENTAL_PROGRAMS: readonly SupplementalProgram[] = [
  CERTIFIER_REPLAY_PROGRAM,
  WORKER_ARTIFACT_PROGRAM,
  DETERMINISTIC_POST_PROGRAM,
  {
    name: "worker-reads",
    spec: "worker-reads.g1.spec.ts",
    outVariable: "G1_WORKER_CAPTURE_OUT",
    scenarios: workerReadScenarios(),
    fixtures: WORKER_READ_FIXTURE_FILES.map((file) => `fixtures/${file}`),
    addedRows: WORKER_READ_FIXTURE_DELTAS,
    stateSuffix: ".state.json",
  },
  {
    name: "known-mutations",
    spec: "known-mutation-probe.g1.spec.ts",
    outVariable: "G1_KNOWN_MUTATION_OUT",
    scenarios: KNOWN_MUTATION_SCENARIOS,
    addedRows: {},
    stateSuffix: ".states.json",
  },
  {
    name: "synthesis",
    spec: "synthesis-probe.g1.spec.ts",
    outVariable: "G1_SYNTHESIS_OUT",
    scenarios: SYNTHESIS_SCENARIOS,
    fixtures: ["fixtures/synthesis-fixtures.sql"],
    addedRows: SYNTHESIS_FIXTURE_COUNTS,
    stateSuffix: ".state.json",
  },
];
