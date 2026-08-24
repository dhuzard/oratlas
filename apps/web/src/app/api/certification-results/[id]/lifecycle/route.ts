import { NextResponse } from "next/server";
import { certificationLifecycleRequestSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import { authenticateCertifier, addCertificationLifecycle } from "@/lib/certification";
import {
  handleCertificationRouteError,
  validateCertifierJsonMutation,
} from "@/lib/certification-api";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateCertifierJsonMutation(request);
    if (invalid) return invalid;
    const auth = await authenticateCertifier(request, "certification:submit");
    const input = certificationLifecycleRequestSchema.parse(await readJsonBody(request));
    return NextResponse.json(
      await addCertificationLifecycle((await params).id, input.kind, input.reason, {
        certifierId: auth.certifierId,
      }),
      { status: 201 },
    );
  } catch (error) {
    return handleCertificationRouteError(error);
  }
}
