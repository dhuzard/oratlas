import { NextResponse } from "next/server";
import { publicationRelationMutationSchema } from "@oratlas/contracts";
import { getServerEnv, requireEditor } from "@/lib/auth";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import { validateSameOriginJsonRequest } from "@/lib/mutation-request";
import {
  createPublicationRelation,
  PublicationProvenanceError,
} from "@/lib/publication-provenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const editor = await requireEditor();
    const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
    if (!integrity.ok) {
      return errorResponse(
        integrity.status === 415 ? "unsupported-media-type" : "forbidden",
        integrity.message,
      );
    }
    const parsed = publicationRelationMutationSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return errorResponse("bad-request", "Invalid publication relationship decision.");
    }
    const { id } = await params;
    const result = await createPublicationRelation(id, parsed.data, editor.id);
    return NextResponse.json(result.relation, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse("payload-too-large", "Request body too large.");
    }
    if (error instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    if (error instanceof PublicationProvenanceError) {
      return errorResponse(error.code, error.message);
    }
    return handleRouteError(error);
  }
}
