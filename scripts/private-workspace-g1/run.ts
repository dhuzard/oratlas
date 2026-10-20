import { runG1Harness } from "./orchestrator.js";

/**
 * CLI entry point for `pnpm g1:private-workspace` (docs/private-workspace-g1-harness.md). Exit
 * codes: 0 passed, 1 a check or a cleanup step failed, 2 target refused before any mutation.
 */
runG1Harness(process.env).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`[g1] harness crashed: ${error instanceof Error ? error.name : "error"}`);
    process.exit(1);
  },
);
