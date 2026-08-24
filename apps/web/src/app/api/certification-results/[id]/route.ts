import { NextResponse } from "next/server";
import { getPublicCertificationResult } from "@/lib/certification";
import { handleCertificationRouteError } from "@/lib/certification-api";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await getPublicCertificationResult((await params).id));
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
