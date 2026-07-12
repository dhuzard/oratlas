import { NextResponse } from "next/server";
import { z } from "zod";
import { editedMetadataSchema } from "@oratlas/contracts";
import { getServerEnv, requireUser } from "@/lib/auth";
import { createSubmission, SubmissionError } from "@/lib/submissions";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { validateSameOriginJsonRequest } from "@/lib/mutation-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  inspectionToken: z.string().min(40).max(100),
  editedMetadata: editedMetadataSchema.optional(),
});

/** Finalize a submission (creates the immutable snapshot + submission record). */
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
      inspectionToken: parsed.data.inspectionToken,
      submitterId: user.id,
      editedMetadata: parsed.data.editedMetadata,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof SubmissionError) return errorResponse(err.code, err.message);
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(err);
  }
}
