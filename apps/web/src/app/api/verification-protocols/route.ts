import { NextResponse } from "next/server";
import { handleVerificationRouteError } from "@/lib/verification-api";
import { listVerificationProtocols } from "@/lib/scientific-verification";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(await listVerificationProtocols());
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
