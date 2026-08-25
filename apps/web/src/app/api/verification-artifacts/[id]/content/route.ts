import { NextResponse } from "next/server";
import { VERIFICATION_ARTIFACT_MAX_BYTES } from "@oratlas/contracts";
import {
  authenticateVerifier,
  getVerificationArtifactContent,
  uploadVerificationArtifact,
  VerificationError,
} from "@/lib/scientific-verification";
import { handleVerificationRouteError } from "@/lib/verification-api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isSafeInteger(length) || length < 0 || length > VERIFICATION_ARTIFACT_MAX_BYTES)
      throw new VerificationError("payload-too-large", "Verification artifact exceeds 8 MiB.");
    const auth = await authenticateVerifier(request, "verification:submit");
    const bytes = new Uint8Array(await request.arrayBuffer());
    const mediaType = request.headers.get("content-type")?.trim() ?? "";
    return NextResponse.json(
      await uploadVerificationArtifact((await params).id, bytes, mediaType, auth, request),
    );
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = request.headers.get("authorization")
      ? await authenticateVerifier(request, "verification:read")
      : undefined;
    const result = await getVerificationArtifactContent((await params).id, request, auth);
    return new NextResponse(result.bytes, {
      headers: {
        "content-type": result.artifact.mediaType,
        "content-length": String(result.artifact.byteLength),
        "x-oratlas-sha256": result.artifact.sha256,
        "cache-control":
          result.artifact.visibility === "public"
            ? "public, immutable, max-age=31536000"
            : "private, no-store",
      },
    });
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
