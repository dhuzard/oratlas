import { NextResponse } from "next/server";
import { publicationProductionAssertionMutationSchema } from "@oratlas/contracts";
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
  createPublicationProductionAssertion,
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
    const parsed = publicationProductionAssertionMutationSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success) {
      return errorResponse("bad-request", "Invalid production provenance assertion.");
    }
    const { id } = await params;
    return NextResponse.json(
      await createPublicationProductionAssertion(id, parsed.data, editor.id),
      { status: 201 },
    );
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
