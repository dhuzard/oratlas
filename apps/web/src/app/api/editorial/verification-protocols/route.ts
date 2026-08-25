import { NextResponse } from "next/server";
import { createVerificationProtocolSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { createVerificationProtocol } from "@/lib/scientific-verification";
import {
  handleVerificationRouteError,
  validateVerificationAdminMutation,
} from "@/lib/verification-api";
export async function POST(request: Request) {
  try {
    const invalid = validateVerificationAdminMutation(request);
    if (invalid) return invalid;
    const admin = await requireAdmin();
    const input = createVerificationProtocolSchema.parse(await readJsonBody(request));
    return NextResponse.json(await createVerificationProtocol(input, admin.id), { status: 201 });
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
