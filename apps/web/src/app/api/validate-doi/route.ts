import { NextResponse } from "next/server";
import { z } from "zod";
import { validateDoi } from "@oratlas/zenodo";
import { getCurrentUser } from "@/lib/auth";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  doi: z.string().min(1).max(500),
  repositoryUrl: z.string().max(2048).optional(),
  title: z.string().max(500).optional(),
  releaseTag: z.string().max(120).optional(),
  expectedKind: z.enum(["version", "concept"]).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const limit = rateLimit(clientKey(request.headers, `doi:${user?.id ?? "anon"}`), 30, 60_000);
    if (!limit.ok) return errorResponse("rate-limited", "Too many DOI checks. Try again shortly.");

    const body = await readJsonBody(request);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return errorResponse("bad-request", "A DOI is required.");

    const report = await validateDoi(parsed.data);
    return NextResponse.json(report);
  } catch (err) {
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(err);
  }
}
