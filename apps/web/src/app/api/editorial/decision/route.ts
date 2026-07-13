import { NextResponse } from "next/server";
import { z } from "zod";
import { editorialOverridesSchema } from "@oratlas/contracts";
import { getServerEnv, requireEditor } from "@/lib/auth";
import { acceptSubmission, decideSubmission, SubmissionError } from "@/lib/submissions";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import { validateSameOriginJsonRequest } from "@/lib/mutation-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  submissionId: z.string().min(1),
  decision: z.enum(["accept", "reject", "request-changes"]),
  note: z.string().max(5000).optional(),
  overrides: editorialOverridesSchema,
});

/** Editorial decision endpoint. Editor role required (checked server-side). */
export async function POST(request: Request) {
  try {
    const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
    if (!integrity.ok)
      return NextResponse.json(
        {
          error: {
            code: integrity.status === 415 ? "bad-request" : "forbidden",
            message: integrity.message,
          },
        },
        { status: integrity.status },
      );
    const editor = await requireEditor();
    const body = await readJsonBody(request);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return errorResponse("bad-request", "Invalid decision payload.");

    if (parsed.data.decision === "accept") {
      const result = await acceptSubmission(
        parsed.data.submissionId,
        editor.id,
        parsed.data.note,
        parsed.data.overrides,
      );
      return NextResponse.json({
        status: "accepted",
        reviewSlug: result.reviewSlug,
        idempotent: result.idempotent,
      });
    }
    await decideSubmission(
      parsed.data.submissionId,
      editor.id,
      parsed.data.decision,
      parsed.data.note,
    );
    return NextResponse.json({ status: parsed.data.decision });
  } catch (err) {
    if (err instanceof SubmissionError) return errorResponse(err.code, err.message);
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(err);
  }
}
