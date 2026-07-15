import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/auth";
import { handleRouteError } from "@/lib/api";
import { listFederationQueue } from "@/lib/federation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireEditor();
    return NextResponse.json(
      { notifications: await listFederationQueue() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
