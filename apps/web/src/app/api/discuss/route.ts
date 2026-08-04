import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@oratlas/config";
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
import { validateSameOriginJsonRequest } from "@/lib/mutation-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestLlmSchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  apiKey: z.string().trim().min(20).max(500),
  model: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9._:-]+$/)
    .optional(),
});

const bodySchema = z.object({
  question: z.string().min(3).max(1000),
  reviewSlugs: z.array(z.string().max(200)).max(50).optional(),
  llm: requestLlmSchema.optional(),
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
      return errorResponse(
        "bad-request",
        "A valid question and optional Anthropic/OpenAI key configuration are required.",
      );

    if (parsed.data.llm) {
      const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
      if (!integrity.ok) {
        return errorResponse(
          integrity.status === 415 ? "bad-request" : "forbidden",
          integrity.message,
        );
      }
    }

    const response = await runDiscussion(
      parsed.data.question,
      parsed.data.reviewSlugs,
      parsed.data.llm,
    );
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(err);
  }
}
