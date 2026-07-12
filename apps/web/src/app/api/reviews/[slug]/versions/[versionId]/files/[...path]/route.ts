import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getPreservedFileContent } from "@/lib/preservation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Preserved raw file content from the exact accepted inspection capture.
 * Repository content is untrusted: it is served as a plain-text download
 * (nosniff, attachment) and is never rendered as HTML.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; versionId: string; path: string[] }> },
) {
  try {
    const { slug, versionId, path } = await params;
    const filePath = path.map((segment) => decodeURIComponent(segment)).join("/");
    if (filePath.length > 500 || filePath.includes("\0")) {
      return errorResponse("bad-request", "Invalid file path.");
    }
    const file = await getPreservedFileContent(slug, versionId, filePath);
    if (!file) {
      return errorResponse(
        "not-found",
        "No preserved content for this path. Only textual files captured at inspection are preserved.",
      );
    }
    const downloadName = (filePath.split("/").pop() ?? "file").replace(/[^A-Za-z0-9._-]/g, "-");
    return new NextResponse(file.content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${downloadName}.txt"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
