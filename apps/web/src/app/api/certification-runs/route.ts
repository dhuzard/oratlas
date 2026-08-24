import { NextResponse } from "next/server";
import { createCertificationRunSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import {
  handleCertificationRouteError,
  validateCertifierJsonMutation,
} from "@/lib/certification-api";
import { authenticateCertifier, createCertificationRun } from "@/lib/certification";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const invalid = validateCertifierJsonMutation(request);
    if (invalid) return invalid;
    const auth = await authenticateCertifier(request, "certification:submit");
    const input = createCertificationRunSchema.parse(await readJsonBody(request));
    const result = await createCertificationRun(input, auth);
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
