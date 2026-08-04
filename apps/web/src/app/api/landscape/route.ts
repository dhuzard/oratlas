import { NextResponse } from "next/server";
import { knowledgeLandscapeQuerySchema } from "@oratlas/contracts";
import { errorResponse, handleRouteError } from "@/lib/api";
import { buildKnowledgeIndex } from "@/lib/index-builder";
import { createKnowledgeLandscapeResponse } from "@/lib/knowledge-landscape-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store, must-revalidate" };

export async function GET(request: Request) {
  try {
    const parameters = new URL(request.url).searchParams;
    const parsed = knowledgeLandscapeQuerySchema.safeParse({
      q: parameters.get("q") || undefined,
      interests: [...new Set(parameters.getAll("interest"))],
      focusNodeId: parameters.get("focus") || undefined,
      reviewSlug: parameters.get("reviewSlug") || undefined,
      claimType: parameters.get("claimType") || undefined,
      relationType: parameters.get("relationType") || undefined,
      trustCriterion: parameters.get("trustCriterion") || undefined,
    });
    if (!parsed.success) {
      return noStore(errorResponse("bad-request", "Invalid knowledge landscape query."));
    }

    const index = await buildKnowledgeIndex();
    return NextResponse.json(await createKnowledgeLandscapeResponse(index, parsed.data), {
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
