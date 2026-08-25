import { NextResponse } from "next/server";
import { listPublicationVersionVerifications } from "@/lib/scientific-verification";
import { handleVerificationRouteError } from "@/lib/verification-api";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await listPublicationVersionVerifications((await params).id));
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
