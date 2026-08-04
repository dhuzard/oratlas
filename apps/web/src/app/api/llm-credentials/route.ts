import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@oratlas/config";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import {
  clearBrowserLlmCredential,
  getLlmCredentialStatus,
  setBrowserLlmCredential,
} from "@/lib/llm-credentials";
import { validateSameOriginJsonRequest } from "@/lib/mutation-request";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const credentialSchema = z
  .object({
    provider: z.enum(["anthropic", "openai"]),
    apiKey: z.string().min(10).max(512).regex(/^\S+$/, "API key cannot contain whitespace."),
    model: z
      .string()
      .min(1)
      .max(120)
      .refine((value) => !containsControlCharacter(value), {
        message: "Model name contains control characters.",
      })
      .optional(),
  })
  .strict();

export async function GET(request: Request) {
  const limit = rateLimit(clientKey(request.headers, "llm-credentials:status"), 60, 60_000);
  if (!limit.ok) return errorResponse("rate-limited", "Too many credential status requests.");
  return noStoreJson(await getLlmCredentialStatus());
}

export async function POST(request: Request) {
  try {
    const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
    if (!integrity.ok) {
      return errorResponse(
        integrity.status === 415 ? "bad-request" : "forbidden",
        integrity.message,
      );
    }
    const limit = rateLimit(clientKey(request.headers, "llm-credentials:set"), 10, 60_000);
    if (!limit.ok) return errorResponse("rate-limited", "Too many credential changes.");
    const parsed = credentialSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return errorResponse(
        "bad-request",
        "Provider, API key, and an optional valid model name are required.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    return noStoreJson(await setBrowserLlmCredential(parsed.data));
  } catch (error) {
    if (error instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (error instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    if (error instanceof TypeError) return errorResponse("bad-request", error.message);
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
    if (!integrity.ok) {
      return errorResponse(
        integrity.status === 415 ? "bad-request" : "forbidden",
        integrity.message,
      );
    }
    const limit = rateLimit(clientKey(request.headers, "llm-credentials:clear"), 10, 60_000);
    if (!limit.ok) return errorResponse("rate-limited", "Too many credential changes.");
    await clearBrowserLlmCredential();
    return noStoreJson(await getLlmCredentialStatus());
  } catch (error) {
    return handleRouteError(error);
  }
}

function noStoreJson(value: unknown): NextResponse {
  return NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
