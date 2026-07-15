import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getFederationNotificationPayload } from "@/lib/federation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await getFederationNotificationPayload((await params).id);
    if (!payload) return errorResponse("not-found", "Federation notification not found.");
    return NextResponse.json(payload, {
      headers: {
        "Content-Type": "application/ld+json; charset=utf-8",
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
