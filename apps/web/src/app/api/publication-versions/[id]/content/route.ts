import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getPublicationVersionContent, PublicationContentError } from "@/lib/publication-content";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await getPublicationVersionContent((await params).id));
  } catch (error) {
    if (error instanceof PublicationContentError) {
      return errorResponse(
        error.message === "Publication version not found." ? "not-found" : "conflict",
        error.message,
      );
    }
    return handleRouteError(error);
  }
}
