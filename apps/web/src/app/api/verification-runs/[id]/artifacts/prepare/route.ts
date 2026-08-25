import { NextResponse } from "next/server";
import { prepareVerificationArtifactSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import { authenticateVerifier, prepareVerificationArtifact } from "@/lib/scientific-verification";
import { handleVerificationRouteError, validateVerifierJsonMutation } from "@/lib/verification-api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateVerifierJsonMutation(request);
    if (invalid) return invalid;
    const auth = await authenticateVerifier(request, "verification:submit");
    const input = prepareVerificationArtifactSchema.parse(await readJsonBody(request));
    const result = await prepareVerificationArtifact((await params).id, input, auth, request);
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
