import process from "node:process";
import { pathToFileURL, URL, URLSearchParams } from "node:url";

const REQUEST_TIMEOUT_MS = 30_000;

export function parseArguments(argv) {
  const [baseUrlValue, ...rest] = argv;
  if (!baseUrlValue) {
    throw new Error(
      "Usage: node scripts/smoke-gcp-beta.mjs BASE_URL --query TEXT --interest INTEREST",
    );
  }
  const base = new URL(baseUrlValue);
  if (!["http:", "https:"].includes(base.protocol)) {
    throw new Error("BASE_URL must use HTTP(S).");
  }
  const interests = [];
  let query;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--query") query = requiredValue(rest, ++index, argument);
    else if (argument === "--interest") interests.push(requiredValue(rest, ++index, argument));
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!query?.trim()) throw new Error("--query is required for a deterministic beta fixture.");
  if (interests.length === 0) throw new Error("At least one --interest is required.");
  base.pathname = base.pathname.replace(/\/+$/, "") || "/";
  return { baseUrl: base.toString().replace(/\/$/, ""), query: query.trim(), interests };
}

export async function runBetaSmoke(options, request = globalThis.fetch) {
  const get = async (path) => {
    const response = await request(`${options.baseUrl}${path}`, {
      headers: { Accept: "application/json, text/html" },
      signal: globalThis.AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`);
    return response;
  };

  const ready = await (await get("/api/health/ready")).json();
  if (ready?.status !== "ready" || ready?.checks?.database !== "ok") {
    throw new Error("Database readiness response is not ready.");
  }

  const homepage = await (await get("/")).text();
  assertIncludes(homepage, "The arXiv for AI-generated scientific reviews", "homepage promise");
  assertIncludes(homepage, "without rewriting the original record", "preservation promise");

  const parameters = new URLSearchParams({ q: options.query });
  options.interests.forEach((interest) => parameters.append("interest", interest));
  const explorePath = `/explore?${parameters}`;
  const explore = await (await get(explorePath)).text();
  assertIncludes(explore, "Show my knowledge path", "personalization question");
  assertIncludes(explore, "Nodes worth exploring for this interest", "graph recommendation view");

  const landscapePath = `/api/landscape?${parameters}`;
  const response = await (await get(landscapePath)).json();
  if (response?.schemaVersion !== "2.0.0") {
    throw new Error(
      `Expected landscape schema 2.0.0, received ${String(response?.schemaVersion)}.`,
    );
  }
  if (response?.algorithm?.id !== "explicit-interest-graph-landscape") {
    throw new Error("The graph-native landscape algorithm is not active.");
  }
  const landscape = response?.landscape;
  if (!landscape || landscape.graphSeedCount < 1 || landscape.graphNodeCount < 2) {
    throw new Error("The beta fixture did not produce a bridged claim and graph neighbor.");
  }
  const confirmedEdge = landscape.edges?.find((edge) => edge.status === "confirmed");
  if (!confirmedEdge) throw new Error("The personalized graph has no confirmed edge.");
  const graphNode = landscape.nodes?.find(
    (node) => node.graphNodeVersionId && node.graphRecordHref && node.graphHref,
  );
  if (!graphNode) throw new Error("No recommended node exposes exact-version and graph links.");
  await get(graphNode.graphRecordHref);
  await get(graphNode.graphHref);

  return {
    status: "ok",
    query: options.query,
    interests: options.interests,
    graphSeedCount: landscape.graphSeedCount,
    graphNodeCount: landscape.graphNodeCount,
    confirmedRelation: confirmedEdge.relationType,
    checkedNodeId: graphNode.graphNodeId,
    checkedNodeVersionId: graphNode.graphNodeVersionId,
  };
}

function requiredValue(values, index, flag) {
  const value = values[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) throw new Error(`Missing ${label}: ${expected}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBetaSmoke(parseArguments(process.argv.slice(2)))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(
        `GCP beta smoke failed: ${error instanceof Error ? error.message : error}\n`,
      );
      process.exitCode = 1;
    });
}
