import { NextResponse } from "next/server";
import { createCertificationProtocolSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { createCertificationProtocol } from "@/lib/certification";
import {
  handleCertificationRouteError,
  validateCertificationAdminMutation,
} from "@/lib/certification-api";
export async function POST(request: Request) {
  try {
    const invalid = validateCertificationAdminMutation(request);
    if (invalid) return invalid;
    const admin = await requireAdmin();
    const input = createCertificationProtocolSchema.parse(await readJsonBody(request));
    return NextResponse.json(await createCertificationProtocol(input, admin.id), { status: 201 });
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
