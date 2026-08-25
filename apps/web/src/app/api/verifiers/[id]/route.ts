import { NextResponse } from "next/server";
import { handleVerificationRouteError } from "@/lib/verification-api";
import { getVerifier } from "@/lib/scientific-verification";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await getVerifier((await params).id));
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
