import { NextResponse } from "next/server";
import { knowledgeRecommendationQuerySchema } from "@oratlas/contracts";
import { errorResponse, handleRouteError } from "@/lib/api";
import { createKnowledgeRecommendationResponse } from "@/lib/knowledge-recommendation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, must-revalidate" };

export async function GET(request: Request) {
  try {
    const parameters = new URL(request.url).searchParams;
    if (parameters.has("focus")) {
      return noStore(
        errorResponse(
          "bad-request",
          "The recommendation endpoint does not accept presentation focus state.",
        ),
      );
    }
    const parsed = knowledgeRecommendationQuerySchema.safeParse({
      q: parameters.get("q") || undefined,
      interests: [...new Set(parameters.getAll("interest"))],
      reviewSlug: parameters.get("reviewSlug") || undefined,
      claimType: parameters.get("claimType") || undefined,
      relationType: parameters.get("relationType") || undefined,
      trustCriterion: parameters.get("trustCriterion") || undefined,
      knownNodeIds: normalizeAndDedupe(parameters.getAll("known")),
    });
    if (!parsed.success) {
      return noStore(errorResponse("bad-request", "Invalid knowledge recommendation parameters."));
    }
    if (!hasExplicitRecommendationScope(parsed.data)) {
      return noStore(
        errorResponse(
          "bad-request",
          "Provide a topic, interest, or filter before requesting recommendations.",
        ),
      );
    }

    return NextResponse.json(await createKnowledgeRecommendationResponse(parsed.data), {
      headers: NO_STORE,
    });
  } catch (error) {
    return noStore(handleRouteError(error));
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
  return response;
}

function normalizeAndDedupe(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function hasExplicitRecommendationScope(query: {
  q?: string;
  interests: readonly string[];
  reviewSlug?: string;
  claimType?: string;
  relationType?: string;
  trustCriterion?: string;
  knownNodeIds: readonly string[];
}): boolean {
  return Boolean(
    query.q ||
    query.interests.length > 0 ||
    query.reviewSlug ||
    query.claimType ||
    query.relationType ||
    query.trustCriterion,
  );
}
