import { NextResponse } from "next/server";
import { handleCertificationRouteError } from "@/lib/certification-api";
import { listCertificationProtocols } from "@/lib/certification";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return NextResponse.json(
      await listCertificationProtocols(
        new URL(request.url).searchParams.get("certifierId") ?? undefined,
      ),
    );
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
