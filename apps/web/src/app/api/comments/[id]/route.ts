import { NextResponse } from "next/server";
import { getServerEnv, requireUser } from "@/lib/auth";
import { CommentError, removeReviewComment } from "@/lib/comments";
import { errorResponse, handleRouteError } from "@/lib/api";
import { validateSameOriginJsonRequest } from "@/lib/mutation-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Remove a comment (author or editor). Soft delete — the row is retained. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
    if (!integrity.ok) {
      return errorResponse(
        integrity.status === 415 ? "bad-request" : "forbidden",
        integrity.message,
      );
    }
    const user = await requireUser();
    const { id } = await params;
    await removeReviewComment(id, user);
    return NextResponse.json({ status: "removed" });
  } catch (err) {
    if (err instanceof CommentError) return errorResponse(err.code, err.message);
    return handleRouteError(err);
  }
}
