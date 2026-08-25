import { NextResponse } from "next/server";
import { verificationRunTransitionSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import { requireEditor } from "@/lib/auth";
import { authenticateVerifier, transitionVerificationRun } from "@/lib/scientific-verification";
import {
  handleVerificationRouteError,
  validateVerificationAdminMutation,
  validateVerifierJsonMutation,
} from "@/lib/verification-api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const bearer = request.headers.get("authorization")?.startsWith("Bearer ") ?? false;
    const invalid = bearer
      ? validateVerifierJsonMutation(request)
      : validateVerificationAdminMutation(request);
    if (invalid) return invalid;
    const input = verificationRunTransitionSchema.parse(await readJsonBody(request));
    const id = (await params).id;
    if (input.status === "cancelled") {
      const editor = await requireEditor();
      return NextResponse.json(await transitionVerificationRun(id, input, { userId: editor.id }));
    }
    const auth = await authenticateVerifier(request, "verification:submit");
    return NextResponse.json(
      await transitionVerificationRun(id, input, { verifier: auth, request }),
    );
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
