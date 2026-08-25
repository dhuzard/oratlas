import { NextResponse } from "next/server";
import { createVerifierSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { createVerifier } from "@/lib/scientific-verification";
import {
  handleVerificationRouteError,
  validateVerificationAdminMutation,
} from "@/lib/verification-api";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const invalid = validateVerificationAdminMutation(request);
    if (invalid) return invalid;
    const admin = await requireAdmin();
    return NextResponse.json(
      await createVerifier(createVerifierSchema.parse(await readJsonBody(request)), admin.id),
      { status: 201 },
    );
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
