import { NextResponse } from "next/server";
import { createCertifierSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { createCertifier } from "@/lib/certification";
import {
  handleCertificationRouteError,
  validateCertificationAdminMutation,
} from "@/lib/certification-api";
export async function POST(request: Request) {
  try {
    const invalid = validateCertificationAdminMutation(request);
    if (invalid) return invalid;
    const admin = await requireAdmin();
    const input = createCertifierSchema.parse(await readJsonBody(request));
    return NextResponse.json(await createCertifier(input, admin.id), { status: 201 });
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
