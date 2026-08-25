import { NextResponse } from "next/server";
import { submitVerificationFindingSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import {
  authenticateVerifier,
  listVerificationFindings,
  submitVerificationFinding,
} from "@/lib/scientific-verification";
import { handleVerificationRouteError, validateVerifierJsonMutation } from "@/lib/verification-api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await listVerificationFindings((await params).id));
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateVerifierJsonMutation(request);
    if (invalid) return invalid;
    const auth = await authenticateVerifier(request, "verification:submit");
    const input = submitVerificationFindingSchema.parse(await readJsonBody(request));
    const result = await submitVerificationFinding((await params).id, input, auth, request);
    return NextResponse.json(result, {
      status: "replayed" in result && result.replayed ? 200 : 201,
    });
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
