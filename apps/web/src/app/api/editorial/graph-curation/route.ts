import { NextResponse } from "next/server";
import { z } from "zod";
import { knowledgeLandscapeQuerySchema } from "@oratlas/contracts";
import { getServerEnv } from "@oratlas/config";
import { requireEditor } from "@/lib/auth";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import { runGraphCuration } from "@/lib/graph-curation-ai";
import { validateSameOriginJsonRequest } from "@/lib/mutation-request";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({
    question: z.string().trim().min(3).max(1_000),
    scope: knowledgeLandscapeQuerySchema,
    llm: z
      .object({
        provider: z.enum(["anthropic", "openai"]),
        apiKey: z.string().trim().min(20).max(500),
        model: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .regex(/^[A-Za-z0-9._:-]+$/)
          .optional(),
      })
      .strict(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const user = await requireEditor();
    const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
    if (!integrity.ok) {
      return errorResponse(
        integrity.status === 415 ? "bad-request" : "forbidden",
        integrity.message,
      );
    }
    const limit = rateLimit(clientKey(request.headers, `graph-curation:${user.id}`), 5, 60_000);
    if (!limit.ok)
      return errorResponse("rate-limited", "Too many curation requests. Try again shortly.");
    const parsed = bodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success)
      return errorResponse(
        "bad-request",
        "A valid question, Explore scope, and transient LLM key are required.",
      );
    return NextResponse.json(
      await runGraphCuration(parsed.data.question, parsed.data.scope, parsed.data.llm),
    );
  } catch (error) {
    if (error instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (error instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(error);
  }
}
