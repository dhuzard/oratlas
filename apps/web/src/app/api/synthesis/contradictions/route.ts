import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { getContradictionMap } from "@/lib/synthesis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public cross-review contradiction map with independence-aware counts. */
export async function GET() {
  try {
    const map = await getContradictionMap();
    return NextResponse.json(map, { headers: { "Cache-Control": "no-store, must-revalidate" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
