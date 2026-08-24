import { NextResponse } from "next/server";
import { externalPublicationRegistrationRequestSchema } from "@oratlas/contracts";
import {
  PublicationAdapterError,
  PublicationRegistrationError,
  RemoteFetchError,
} from "@oratlas/publications";
import { requireEditor, getServerEnv } from "@/lib/auth";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import {
  PublicationRegistrationConflictError,
  registerExternalPublication,
} from "@/lib/external-publication-registration";
import { validateSameOriginJsonRequest } from "@/lib/mutation-request";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const editor = await requireEditor();
    const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
    if (!integrity.ok) {
      return errorResponse(
        integrity.status === 415 ? "unsupported-media-type" : "forbidden",
        integrity.message,
      );
    }
    const limit = rateLimit(
      clientKey(request.headers, `external-publication-register:${editor.id}`),
      5,
      60_000,
    );
    if (!limit.ok) {
      return errorResponse(
        "rate-limited",
        "Too many publication registration requests. Try again shortly.",
      );
    }
    const parsed = externalPublicationRegistrationRequestSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success) {
      return errorResponse(
        "bad-request",
        "A valid HTTPS manifestUrl and optional publicationType are required.",
      );
    }
    const result = await registerExternalPublication({
      ...parsed.data,
      actorId: editor.id,
    });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse("payload-too-large", "Request body too large.");
    }
    if (error instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    if (error instanceof PublicationRegistrationConflictError) {
      return errorResponse("conflict", "The registration conflicts with an immutable capture.");
    }
    if (error instanceof PublicationRegistrationError) {
      if (error.code === "limit-exceeded") {
        return errorResponse("payload-too-large", "An external publication limit was exceeded.");
      }
      return errorResponse(
        "bad-request",
        error.code === "unsupported-protocol"
          ? "The manifest schema version is not supported."
          : "The external publication does not satisfy the registration contract.",
      );
    }
    if (error instanceof PublicationAdapterError) {
      return errorResponse(
        "bad-request",
        "The external publication does not satisfy the registration contract.",
      );
    }
    if (error instanceof RemoteFetchError) {
      if (error.code === "response-too-large") {
        return errorResponse("payload-too-large", "An external response exceeded its byte limit.");
      }
      if (error.code === "unsafe-url" || error.code === "unsafe-destination") {
        return errorResponse("bad-request", "The external publication URL is not allowed.");
      }
      return errorResponse(
        "upstream-error",
        "The external publication could not be fetched safely.",
      );
    }
    return handleRouteError(error);
  }
}
