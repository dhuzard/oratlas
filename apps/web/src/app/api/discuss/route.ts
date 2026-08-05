import { NextResponse } from "next/server";
import { z } from "zod";
import { discussionTraversalScopeSchema } from "@oratlas/contracts";
import { getServerEnv } from "@oratlas/config";
import { getCurrentUser } from "@/lib/auth";
import { runDiscussion } from "@/lib/discuss";
import { DiscussionScopeError } from "@/lib/discussion-scope";
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

const bodySchema = z
  .object({
    question: z.string().min(3).max(1000),
    scope: discussionTraversalScopeSchema,
    llm: requestLlmSchema.optional(),
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
        "A valid question, exact traversed graph scope, and optional Anthropic/OpenAI key configuration are required.",
      );

    const response = await runDiscussion(parsed.data.question, parsed.data.scope, parsed.data.llm);
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    if (err instanceof DiscussionScopeError) return errorResponse(err.code, err.message);
    return handleRouteError(err);
  }
}
