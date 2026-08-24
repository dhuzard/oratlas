import { NextResponse } from "next/server";
import { certificationRunTerminalTransitionSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import {
  handleCertificationRouteError,
  validateCertifierJsonMutation,
} from "@/lib/certification-api";
import { authenticateCertifier, transitionCertificationRun } from "@/lib/certification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateCertifierJsonMutation(request);
    if (invalid) return invalid;
    const auth = await authenticateCertifier(request, "certification:submit");
    const input = certificationRunTerminalTransitionSchema.parse(await readJsonBody(request));
    const result = await transitionCertificationRun((await params).id, input, auth);
    return NextResponse.json(result);
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
