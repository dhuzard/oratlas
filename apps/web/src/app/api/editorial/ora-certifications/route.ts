import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, handleRouteError, readJsonBody } from "@/lib/api";
import { requireEditor } from "@/lib/auth";
import { validateCertificationAdminMutation } from "@/lib/certification-api";
import {
  OraCertificationUnavailableError,
  getOraCertificationReadiness,
  initiateOraCertification,
} from "@/lib/ora-certification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({ publicationVersionId: z.string().min(1) }).strict();

export async function GET(request: Request) {
  try {
    await requireEditor();
    const publicationVersionId = new URL(request.url).searchParams.get("publicationVersionId");
    if (!publicationVersionId) return errorResponse("bad-request", "publicationVersionId is required.");
    return NextResponse.json(await getOraCertificationReadiness(publicationVersionId));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const invalid = validateCertificationAdminMutation(request);
    if (invalid) return invalid;
    await requireEditor();
    const input = requestSchema.parse(await readJsonBody(request));
    return NextResponse.json(await initiateOraCertification(input.publicationVersionId), {
      status: 201,
    });
  } catch (error) {
    if (error instanceof OraCertificationUnavailableError)
      return errorResponse("upstream-error", error.message);
    if (error instanceof z.ZodError)
      return errorResponse("bad-request", "Invalid ORA certification request.");
    return handleRouteError(error);
  }
}
