import { NextResponse } from "next/server";
import { createVerificationRunSchema } from "@oratlas/contracts";
import { requireEditor } from "@/lib/auth";
import { readJsonBody } from "@/lib/api";
import { createVerificationRun } from "@/lib/scientific-verification";
import {
  handleVerificationRouteError,
  validateVerificationAdminMutation,
} from "@/lib/verification-api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const invalid = validateVerificationAdminMutation(request);
    if (invalid) return invalid;
    const editor = await requireEditor();
    const result = await createVerificationRun(
      createVerificationRunSchema.parse(await readJsonBody(request)),
      editor.id,
    );
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
