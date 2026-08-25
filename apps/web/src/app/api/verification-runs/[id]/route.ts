import { NextResponse } from "next/server";
import { handleVerificationRouteError } from "@/lib/verification-api";
import { getVerificationRun } from "@/lib/scientific-verification";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await getVerificationRun((await params).id));
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
