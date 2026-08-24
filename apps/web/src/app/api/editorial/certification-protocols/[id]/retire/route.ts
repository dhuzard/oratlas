import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { retireCertificationProtocol } from "@/lib/certification";
import {
  handleCertificationRouteError,
  validateCertificationAdminMutation,
} from "@/lib/certification-api";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateCertificationAdminMutation(request);
    if (invalid) return invalid;
    const admin = await requireAdmin();
    return NextResponse.json(await retireCertificationProtocol((await params).id, admin.id));
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
