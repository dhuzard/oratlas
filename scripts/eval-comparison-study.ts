import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarizeComparisonStudy } from "./comparison-study-evaluation.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: pnpm eval:comparison-study <local-study-artifact.json>");
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(readFileSync(resolve(inputPath), "utf8")) as unknown;
    console.log(JSON.stringify(summarizeComparisonStudy(input), null, 2));
  } catch {
    console.error("Comparison study input is missing or invalid.");
    process.exitCode = 2;
  }
}
