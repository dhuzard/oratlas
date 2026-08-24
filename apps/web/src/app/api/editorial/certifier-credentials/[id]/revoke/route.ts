import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { revokeCertifierCredential } from "@/lib/certification";
import {
  handleCertificationRouteError,
  validateCertificationAdminMutation,
} from "@/lib/certification-api";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateCertificationAdminMutation(request);
    if (invalid) return invalid;
    const admin = await requireAdmin();
    await revokeCertifierCredential((await params).id, admin.id);
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
