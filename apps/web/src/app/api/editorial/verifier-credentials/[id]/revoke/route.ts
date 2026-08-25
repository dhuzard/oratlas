import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { revokeVerifierCredential } from "@/lib/scientific-verification";
import {
  handleVerificationRouteError,
  validateVerificationAdminMutation,
} from "@/lib/verification-api";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateVerificationAdminMutation(request);
    if (invalid) return invalid;
    const admin = await requireAdmin();
    await revokeVerifierCredential((await params).id, admin.id);
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
