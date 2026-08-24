import { NextResponse } from "next/server";
import { handleCertificationRouteError } from "@/lib/certification-api";
import { authenticateCertifier, getCertificationRun } from "@/lib/certification";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateCertifier(request, "certification:read");
    return NextResponse.json(await getCertificationRun((await params).id, auth.certifierId));
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
