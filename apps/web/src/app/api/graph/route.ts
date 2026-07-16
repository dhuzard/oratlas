import { NextResponse } from "next/server";
import { publicGraphQuerySchema } from "@oratlas/contracts";
import { errorResponse, handleRouteError } from "@/lib/api";
import { GraphQueryError, queryPublicGraph } from "@/lib/graph-query";
import { clientKey, rateLimit, rateLimitDefaults } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const defaults = rateLimitDefaults();
    const budget = rateLimit(
      clientKey(request.headers, "public-graph"),
      defaults.max,
      defaults.windowMs,
    );
    if (!budget.ok) {
      const response = errorResponse("rate-limited", "Too many graph requests.");
      response.headers.set(
        "Retry-After",
        String(Math.max(1, Math.ceil((budget.resetAt - Date.now()) / 1000))),
      );
      return response;
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
      return errorResponse(
        "bad-request",
        "Invalid graph query.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    return NextResponse.json(await queryPublicGraph(parsed.data), {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (error) {
    if (error instanceof GraphQueryError) return errorResponse(error.code, error.message);
    return handleRouteError(error);
  }
}
