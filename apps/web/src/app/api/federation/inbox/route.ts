import { NextResponse } from "next/server";
import { z } from "zod";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import {
  FederationError,
  listFederationInbox,
  receiveFederationNotification,
} from "@/lib/federation";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** LDN Inbox container listing notification resource URLs. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = z
      .object({
        cursor: z.string().trim().min(1).max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict()
      .parse(Object.fromEntries(url.searchParams));
    const page = await listFederationInbox(query);
    return NextResponse.json(page.document, {
      headers: {
        "Content-Type": "application/ld+json; charset=utf-8",
        "Cache-Control": "no-store, must-revalidate",
        ...(page.nextUrl ? { Link: `<${page.nextUrl}>; rel="next"` } : {}),
      },
    });
  } catch (error) {
    if (error instanceof FederationError) return errorResponse(error.code, error.message);
    if (error instanceof z.ZodError) return errorResponse("bad-request", "Invalid inbox page.");
    return handleRouteError(error);
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "GET, HEAD, OPTIONS, POST",
      "Accept-Post": "application/ld+json, application/json",
    },
  });
}

/** Public COAR Notify inbox. Payload URLs are stored as identifiers and never fetched. */
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json") && !contentType.includes("application/ld+json")) {
      return errorResponse("bad-request", "COAR Notify inbox requires JSON-LD.");
    }
    const limit = rateLimit(clientKey(request.headers, "federation-inbox"), 30, 60_000);
    if (!limit.ok) return errorResponse("rate-limited", "Too many federation notifications.");

    const receipt = await receiveFederationNotification(await readJsonBody(request));
    const location = `/api/federation/notifications/${encodeURIComponent(receipt.id)}`;
    return NextResponse.json(receipt, {
      status: receipt.deduplicated ? 200 : 202,
      headers: { Location: location, "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof FederationError) return errorResponse(error.code, error.message);
    if (error instanceof z.ZodError) {
      return errorResponse(
        "bad-request",
        "Invalid or unsupported COAR Notify payload.",
        error.issues.map((issue) => issue.message),
      );
    }
    if (error instanceof BodyTooLargeError) {
      return errorResponse("payload-too-large", "Federation notification is too large.");
    }
    if (error instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(error);
  }
}
