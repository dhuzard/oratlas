import { runAtlasCheckCli } from "../packages/atlas-check/src/cli.js";

void runAtlasCheckCli(process.argv.slice(2)).then((status) => {
  process.exitCode = status;
});
