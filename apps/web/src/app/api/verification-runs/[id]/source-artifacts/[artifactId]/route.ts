import { NextResponse } from "next/server";
import { authenticateVerifier, getVerificationSourceArtifact } from "@/lib/scientific-verification";
import { handleVerificationRouteError } from "@/lib/verification-api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  try {
    const auth = await authenticateVerifier(request, "verification:read");
    const { id, artifactId } = await params;
    const result = await getVerificationSourceArtifact(id, artifactId, auth, request);
    return new NextResponse(result.bytes, {
      headers: {
        "content-type": result.capture.mediaType,
        "content-length": String(result.capture.byteLength),
        "x-oratlas-sha256": result.capture.contentSha256,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
