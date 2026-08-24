import { NextResponse } from "next/server";
import { PublicationClaimMaterializationError } from "@oratlas/db";
import { getServerEnv, requireEditor } from "@/lib/auth";
import { errorResponse, handleRouteError } from "@/lib/api";
import { materializeExternalPublicationClaim } from "@/lib/external-publication-materialization";
import { validateSameOriginJsonRequest } from "@/lib/mutation-request";

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
    const { id } = await params;
    const result = await materializeExternalPublicationClaim(id, editor.id);
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    if (error instanceof PublicationClaimMaterializationError) {
      return errorResponse(
        error.message === "Claim occurrence not found." ? "not-found" : "conflict",
        error.message,
      );
    }
    return handleRouteError(error);
  }
}
