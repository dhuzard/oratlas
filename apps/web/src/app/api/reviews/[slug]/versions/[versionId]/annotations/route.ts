import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { appBaseUrl } from "@/lib/base-url";
import { buildCommentAnnotationPage } from "@/lib/comment-annotations";
import { listReviewComments } from "@/lib/comments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public W3C Web Annotation representation for people and autonomous agents. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; versionId: string }> },
) {
  try {
    const { slug, versionId } = await params;
    const comments = await listReviewComments(slug, versionId);
    if (!comments) return errorResponse("not-found", "Review version not found.");
    const requestPath = new URL(request.url).pathname;
    const publicRequestUrl = new URL(requestPath, `${appBaseUrl()}/`).toString();
    return NextResponse.json(buildCommentAnnotationPage(publicRequestUrl, comments), {
      headers: {
        "Content-Type": "application/ld+json; charset=utf-8",
        Link: '<http://www.w3.org/ns/anno.jsonld>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"',
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
