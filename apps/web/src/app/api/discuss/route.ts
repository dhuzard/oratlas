import { NextResponse } from "next/server";
import { z } from "zod";
import { discussionTraversalScopeSchema, requestLlmConfigSchema } from "@oratlas/contracts";
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

const bodySchema = z
  .object({
    question: z.string().min(3).max(1000),
    scope: discussionTraversalScopeSchema,
    llm: requestLlmConfigSchema.optional(),
  })
  .strict();

const DISCUSSION_LIMIT = 15;
const ANONYMOUS_BYOK_LIMIT = 5;

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
      DISCUSSION_LIMIT,
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

    if (!user && parsed.data.llm) {
      const anonymousByok = rateLimit(
        clientKey(request.headers, "discuss:anonymous-byok"),
        ANONYMOUS_BYOK_LIMIT,
        60_000,
      );
      if (!anonymousByok.ok)
        return errorResponse(
          "rate-limited",
          "Too many provider-backed discussion requests. Sign in or try again shortly.",
        );
    }

    const response = await runDiscussion(parsed.data.question, parsed.data.scope, parsed.data.llm, {
      allowServerProvider: Boolean(user),
      persistAgentRun: Boolean(user),
    });
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    if (err instanceof DiscussionScopeError) return errorResponse(err.code, err.message);
    return handleRouteError(err);
  }
}
