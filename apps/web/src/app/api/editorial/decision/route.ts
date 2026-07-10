import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEditor } from "@/lib/auth";
import { acceptSubmission, decideSubmission, SubmissionError } from "@/lib/submissions";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  submissionId: z.string().min(1),
  decision: z.enum(["accept", "reject", "request-changes"]),
  note: z.string().max(5000).optional(),
});

/** Editorial decision endpoint. Editor role required (checked server-side). */
export async function POST(request: Request) {
  try {
    const editor = await requireEditor();
    const body = await readJsonBody(request);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return errorResponse("bad-request", "Invalid decision payload.");

    if (parsed.data.decision === "accept") {
      const result = await acceptSubmission(parsed.data.submissionId, editor.id, parsed.data.note);
      return NextResponse.json({ status: "accepted", reviewSlug: result.reviewSlug });
    }
    await decideSubmission(
      parsed.data.submissionId,
      editor.id,
      parsed.data.decision,
      parsed.data.note,
    );
    return NextResponse.json({ status: parsed.data.decision });
  } catch (err) {
    if (err instanceof SubmissionError) return errorResponse("bad-request", err.message);
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(err);
  }
}
