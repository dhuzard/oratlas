import { NextResponse } from "next/server";
import { createCommentInputSchema } from "@oratlas/contracts";
import { getServerEnv, requireUser } from "@/lib/auth";
import { CommentError, createReviewComment, listReviewComments } from "@/lib/comments";
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

/** Threaded community comments for a review. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const list = await listReviewComments(slug);
    if (!list) return errorResponse("not-found", "Review not found.");
    return NextResponse.json(list);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** Post a comment or reply. Sign-in required. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
    if (!integrity.ok) {
      return errorResponse(
        integrity.status === 415 ? "bad-request" : "forbidden",
        integrity.message,
      );
    }
    const user = await requireUser();
    const limit = rateLimit(clientKey(request.headers, `comment:${user.id}`), 10, 60_000);
    if (!limit.ok) return errorResponse("rate-limited", "Too many comments. Try again shortly.");

    const { slug } = await params;
    const body = await readJsonBody(request);
    const parsed = createCommentInputSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "bad-request",
        "Invalid comment payload.",
        parsed.error.issues.map((i) => i.message),
      );
    }

    const result = await createReviewComment(slug, user, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof CommentError) return errorResponse(err.code, err.message);
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(err);
  }
}
