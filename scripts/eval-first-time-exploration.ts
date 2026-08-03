import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarizeFirstTimeExploration } from "./first-time-exploration-evaluation.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: pnpm eval:exploration <pseudonymous-session-results.json>");
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(readFileSync(resolve(inputPath), "utf8")) as unknown;
    console.log(JSON.stringify(summarizeFirstTimeExploration(input), null, 2));
  } catch {
    console.error("Exploration evaluation input is missing or invalid.");
    process.exitCode = 2;
  }
}
