import { NextResponse } from "next/server";
import { z } from "zod";
import { editedMetadataSchema } from "@oratlas/contracts";
import { requireUser } from "@/lib/auth";
import { createSubmission, SubmissionError } from "@/lib/submissions";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  url: z.string().min(1).max(2048),
  editedMetadata: editedMetadataSchema.optional(),
});

/** Finalize a submission (creates the immutable snapshot + submission record). */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const limit = rateLimit(clientKey(request.headers, `submit:${user.id}`), 10, 60_000);
    if (!limit.ok) return errorResponse("rate-limited", "Too many submissions. Try again shortly.");

    const body = await readJsonBody(request);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "bad-request",
        "Invalid submission payload.",
        parsed.error.issues.map((i) => i.message),
      );
    }

    const result = await createSubmission({
      url: parsed.data.url,
      submitterId: user.id,
      editedMetadata: parsed.data.editedMetadata,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof SubmissionError) return errorResponse("bad-request", err.message);
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(err);
  }
}
