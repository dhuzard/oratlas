import { NextResponse } from "next/server";
import { issueVerifierCredentialSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { issueVerifierCredential } from "@/lib/scientific-verification";
import {
  handleVerificationRouteError,
  validateVerificationAdminMutation,
} from "@/lib/verification-api";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateVerificationAdminMutation(request);
    if (invalid) return invalid;
    const admin = await requireAdmin();
    const input = issueVerifierCredentialSchema.parse(await readJsonBody(request));
    return NextResponse.json(await issueVerifierCredential((await params).id, input, admin.id), {
      status: 201,
    });
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
