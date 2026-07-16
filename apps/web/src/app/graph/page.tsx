import { type Metadata } from "next";
import { publicGraphQuerySchema } from "@oratlas/contracts";
import { GraphQueryError, queryPublicGraph } from "@/lib/graph-query";
import { GraphError, GraphExplorer, GraphLanding } from "./GraphExplorer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Graph explorer",
  description: "Explore bounded public relationships between exact knowledge-node versions.",
};

type RawParams = Record<string, string | string[] | undefined>;

export default async function GraphPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const raw = await searchParams;
  const hasQuery = raw.seed !== undefined || raw.q !== undefined;
  return (
    <>
      <div className="hero">
        <h1>Knowledge graph explorer</h1>
        <p className="lead">
          Navigate a bounded, public neighborhood of immutable node versions. The relation list is
          the authoritative view and works without JavaScript.
        </p>
      </div>
      {hasQuery ? await renderResults(raw) : <GraphLanding />}
    </>
  );
}

async function renderResults(raw: RawParams) {
  const one = (name: string) =>
    typeof raw[name] === "string" ? raw[name] : raw[name] === undefined ? undefined : raw[name];
  const boolean = (name: string) => {
    const value = one(name);
    return value === undefined || value === ""
      ? undefined
      : value === "true"
        ? true
        : value === "false"
          ? false
          : value;
  };
  const parsed = publicGraphQuerySchema.safeParse({
    seed: one("seed") || undefined,
    q: one("q") || undefined,
    depth: one("depth") === undefined ? 1 : Number(one("depth")),
    limit: one("limit") === undefined ? 10 : Number(one("limit")),
    cursor: one("cursor") || undefined,
    kind: one("kind") || undefined,
    relationType: one("relationType") || undefined,
    edgeStatus: one("edgeStatus") || undefined,
    hasTrust: boolean("hasTrust"),
  });
  if (!parsed.success)
    return <GraphError message="Check the node or topic and filter values, then try again." />;
  try {
    const result = await queryPublicGraph(parsed.data);
    return <GraphExplorer result={result} query={parsed.data} />;
  } catch (error) {
    if (error instanceof GraphQueryError) return <GraphError message={error.message} />;
    console.error("Graph page query failed", error);
    return <GraphError message="The public graph is temporarily unavailable. Please try again." />;
  }
}
