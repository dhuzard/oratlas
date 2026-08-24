import { NextResponse } from "next/server";
import { handleCertificationRouteError } from "@/lib/certification-api";
import { listCertifiers } from "@/lib/certification";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(await listCertifiers());
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
