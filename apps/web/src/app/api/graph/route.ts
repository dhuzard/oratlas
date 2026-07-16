import { NextResponse } from "next/server";
import { publicGraphQuerySchema } from "@oratlas/contracts";
import { errorResponse, handleRouteError } from "@/lib/api";
import { GraphQueryError, queryPublicGraph } from "@/lib/graph-query";
import { clientKey, rateLimit, rateLimitDefaults, type RateLimitResult } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function graphResponseHeaders(
  response: NextResponse,
  budget?: RateLimitResult,
  maximum?: number,
): NextResponse {
  response.headers.set("Cache-Control", "no-store, must-revalidate");
  if (budget && maximum !== undefined) {
    response.headers.set("RateLimit-Limit", String(maximum));
    response.headers.set("RateLimit-Remaining", String(budget.remaining));
    response.headers.set("RateLimit-Reset", String(Math.ceil(budget.resetAt / 1_000)));
  }
  return response;
}

export async function GET(request: Request) {
  let budget: RateLimitResult | undefined;
  let maximum: number | undefined;
  try {
    const defaults = rateLimitDefaults();
    maximum = defaults.max;
    budget = rateLimit(clientKey(request.headers, "public-graph"), defaults.max, defaults.windowMs);
    if (!budget.ok) {
      const response = errorResponse("rate-limited", "Too many graph requests.");
      response.headers.set(
        "Retry-After",
        String(Math.max(1, Math.ceil((budget.resetAt - Date.now()) / 1000))),
      );
      return graphResponseHeaders(response, budget, maximum);
    }

    const params = new URL(request.url).searchParams;
    const boolean = (name: string) => {
      const value = params.get(name);
      return value === null
        ? undefined
        : value === "true"
          ? true
          : value === "false"
            ? false
            : value;
    };
    const parsed = publicGraphQuerySchema.safeParse({
      seed: params.get("seed") || undefined,
      q: params.get("q") || undefined,
      depth: params.has("depth") ? Number(params.get("depth")) : undefined,
      limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      cursor: params.get("cursor") || undefined,
      kind: params.get("kind") || undefined,
      relationType: params.get("relationType") || undefined,
      edgeStatus: params.get("edgeStatus") || undefined,
      hasTrust: boolean("hasTrust"),
    });
    if (!parsed.success) {
      return graphResponseHeaders(
        errorResponse(
          "bad-request",
          "Invalid graph query.",
          parsed.error.issues.map((issue) => issue.message),
        ),
        budget,
        maximum,
      );
    }
    return graphResponseHeaders(
      NextResponse.json(await queryPublicGraph(parsed.data)),
      budget,
      maximum,
    );
  } catch (error) {
    const response =
      error instanceof GraphQueryError
        ? errorResponse(error.code, error.message)
        : handleRouteError(error);
    return graphResponseHeaders(response, budget, maximum);
  }
}
