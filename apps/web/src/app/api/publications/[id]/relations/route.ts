import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { listPublicationRelations, PublicationProvenanceError } from "@/lib/publication-provenance";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await listPublicationRelations(id));
  } catch (error) {
    if (error instanceof PublicationProvenanceError) {
      return errorResponse(error.code, error.message);
    }
    return handleRouteError(error);
  }
}
