import { KNOWN_MUTATION_SCENARIOS } from "./known-mutation-scenarios.js";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
/** Fixed descriptor for root's runner catalog; this module performs no orchestration. */
export const KNOWN_MUTATION_PROGRAM = {
  id: "known-mutations",
  spec: "scripts/private-workspace-g1/known-mutation-probe.g1.spec.ts",
  outVariable: "G1_KNOWN_MUTATION_OUT",
  scenarios: KNOWN_MUTATION_SCENARIOS,
  sqlCountDeltas: Object.fromEntries(PUBLIC_SELECT_TABLES.map((table) => [table, 0])),
} as const;
