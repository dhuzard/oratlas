import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { publicChildEnv, assertPublicChildEnv } from "../child-env.js";

/** Closed serving environment, never process.env spread. Provider secrets are absent. */
export function nextServingEnvironment(databaseUrl: string, root: string, output: string) {
  for (const directory of [root, resolve(root, "apps/web")]) {
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
      if (existsSync(resolve(directory, name)))
        throw new Error("Next dotenv files are forbidden in the synthetic serving target");
    }
  }
  const env = {
    ...publicChildEnv(databaseUrl),
    NODE_ENV: "production" as const,
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `--import=${JSON.stringify(resolve(root, "scripts/private-workspace-g1/next-serving/clock.mjs"))}`,
    G1_NEXT_CAPTURE_OUT: output,
  };
  assertPublicChildEnv(env, "G1_NEXT_CAPTURE_OUT");
  return env;
}
