import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { CommentError, removeReviewComment } from "@/lib/comments";
import { errorResponse, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Remove a comment (author or editor). Soft delete — the row is retained. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await removeReviewComment(id, user);
    return NextResponse.json({ status: "removed" });
  } catch (err) {
    if (err instanceof CommentError) return errorResponse(err.code, err.message);
    return handleRouteError(err);
  }
}
