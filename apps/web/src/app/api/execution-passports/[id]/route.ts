import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getPublicExecutionPassport } from "@/lib/execution-passports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public archive-only export; never resolves or executes upstream content. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const passport = await getPublicExecutionPassport(id);
    if (!passport) return errorResponse("not-found", "Execution passport not found.");
    return NextResponse.json(passport, {
      headers: {
        "Content-Type": "application/vnd.oratlas.execution-passport.v1+json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
