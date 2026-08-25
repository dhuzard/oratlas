import { NextResponse } from "next/server";
import { authenticateVerifier, getVerificationInput } from "@/lib/scientific-verification";
import { handleVerificationRouteError } from "@/lib/verification-api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateVerifier(request, "verification:read");
    return NextResponse.json(await getVerificationInput((await params).id, auth, request));
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
