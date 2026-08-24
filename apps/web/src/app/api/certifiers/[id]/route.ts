import { NextResponse } from "next/server";
import { handleCertificationRouteError } from "@/lib/certification-api";
import { getCertifier } from "@/lib/certification";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await getCertifier((await params).id));
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
