import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import {
  getPublicationVersionPacket,
  PublicationVersionPacketError,
} from "@/lib/publication-version-packet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getPublicationVersionPacket(id));
  } catch (error) {
    if (error instanceof PublicationVersionPacketError) {
      return errorResponse(
        error.message === "Publication version not found." ? "not-found" : "conflict",
        error.message,
      );
    }
    return handleRouteError(error);
  }
}
