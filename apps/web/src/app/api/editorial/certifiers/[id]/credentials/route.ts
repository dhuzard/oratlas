import { NextResponse } from "next/server";
import { issueCertifierCredentialSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { issueCertifierCredential } from "@/lib/certification";
import {
  handleCertificationRouteError,
  validateCertificationAdminMutation,
} from "@/lib/certification-api";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateCertificationAdminMutation(request);
    if (invalid) return invalid;
    const admin = await requireAdmin();
    const input = issueCertifierCredentialSchema.parse(await readJsonBody(request));
    return NextResponse.json(await issueCertifierCredential((await params).id, input, admin.id), {
      status: 201,
    });
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
