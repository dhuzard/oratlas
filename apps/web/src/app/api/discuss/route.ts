import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { runDiscussion } from "@/lib/discuss";
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
  question: z.string().min(3).max(1000),
  reviewSlugs: z.array(z.string().max(200)).max(50).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const limit = rateLimit(
      clientKey(request.headers, `discuss:${user?.id ?? "anon"}`),
      15,
      60_000,
    );
    if (!limit.ok)
      return errorResponse("rate-limited", "Too many discussion requests. Try again shortly.");

    const body = await readJsonBody(request);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success)
      return errorResponse("bad-request", "A question (3–1000 chars) is required.");

    const response = await runDiscussion(parsed.data.question, parsed.data.reviewSlugs);
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(err);
  }
}
