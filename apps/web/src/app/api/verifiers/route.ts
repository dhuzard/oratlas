import { NextResponse } from "next/server";
import { handleVerificationRouteError } from "@/lib/verification-api";
import { listVerifiers } from "@/lib/scientific-verification";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(await listVerifiers());
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
