import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@oratlas/config";
import {
  AiIngestionExtractionError,
  extractInspectionCandidatesWithAi,
} from "@/lib/ai-ingestion-extraction";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { validateSameOriginJsonRequest } from "@/lib/mutation-request";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z
  .object({
    inspectionToken: z.string().min(20).max(200),
    instruction: z.string().trim().max(2_000).optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
    if (!integrity.ok) {
      return errorResponse(
        integrity.status === 415 ? "bad-request" : "forbidden",
        integrity.message,
      );
    }
    const user = await requireUser();
    const limit = rateLimit(clientKey(request.headers, `ai-inspect:${user.id}`), 4, 60_000);
    if (!limit.ok) {
      return errorResponse("rate-limited", "Too many AI extraction requests. Try again shortly.");
    }
    const parsed = requestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return errorResponse("bad-request", "Invalid extraction request.");
    return NextResponse.json(
      await extractInspectionCandidatesWithAi({ actorId: user.id, ...parsed.data }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AiIngestionExtractionError) {
      return errorResponse(error.code, error.message);
    }
    if (error instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (error instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(error);
  }
}
