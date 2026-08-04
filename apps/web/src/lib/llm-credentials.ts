import "server-only";
import { cookies } from "next/headers";
import { getServerEnv } from "@oratlas/config";
import {
  createAnthropicProvider,
  createOpenAiProvider,
  type LlmProvider,
} from "@oratlas/knowledge";
import {
  createLlmCredentialToken,
  LLM_CREDENTIAL_MAX_AGE_SECONDS,
  readLlmCredentialToken,
  type LlmCredentialPayload,
  type LlmProviderName,
} from "./llm-credential-token";

const COOKIE_NAME = "oratlas_llm_credential";

export interface ResolvedLlmProvider {
  provider: LlmProvider;
  source: "byok" | "platform";
  expiresAt?: string;
}

export interface LlmCredentialStatus {
  available: boolean;
  source: "byok" | "platform" | "none";
  provider?: LlmProviderName;
  model?: string;
  expiresAt?: string;
}

export function defaultModelFor(provider: LlmProviderName): string {
  return provider === "anthropic" ? "claude-sonnet-5" : "gpt-5";
}

export async function setBrowserLlmCredential(input: {
  provider: LlmProviderName;
  apiKey: string;
  model?: string;
}): Promise<LlmCredentialStatus> {
  const env = getServerEnv();
  const model = input.model?.trim() || defaultModelFor(input.provider);
  const apiKey = input.apiKey.trim();
  const now = Date.now();
  const token = createLlmCredentialToken(
    { provider: input.provider, apiKey, model },
    env.sessionSecret,
    now,
  );
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: LLM_CREDENTIAL_MAX_AGE_SECONDS,
  });
  return {
    available: true,
    source: "byok",
    provider: input.provider,
    model,
    expiresAt: new Date(now + LLM_CREDENTIAL_MAX_AGE_SECONDS * 1_000).toISOString(),
  };
}

export async function clearBrowserLlmCredential(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getLlmCredentialStatus(): Promise<LlmCredentialStatus> {
  const credential = await readBrowserCredential();
  if (credential) return statusFromCredential(credential);
  const platform = platformProviderConfiguration();
  return platform
    ? {
        available: true,
        source: "platform",
        provider: platform.provider,
        model: platform.model,
      }
    : { available: false, source: "none" };
}

export async function resolveLlmProvider(): Promise<ResolvedLlmProvider | null> {
  const credential = await readBrowserCredential();
  if (credential) {
    return {
      provider: instantiateProvider(credential.provider, credential.apiKey, credential.model),
      source: "byok",
      expiresAt: new Date(credential.expiresAtMs).toISOString(),
    };
  }
  const platform = platformProviderConfiguration();
  if (!platform) return null;
  return {
    provider: instantiateProvider(platform.provider, platform.apiKey, platform.model),
    source: "platform",
  };
}

async function readBrowserCredential(): Promise<LlmCredentialPayload | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  return readLlmCredentialToken(token, getServerEnv().sessionSecret);
}

function statusFromCredential(credential: LlmCredentialPayload): LlmCredentialStatus {
  return {
    available: true,
    source: "byok",
    provider: credential.provider,
    model: credential.model,
    expiresAt: new Date(credential.expiresAtMs).toISOString(),
  };
}

function platformProviderConfiguration():
  | { provider: LlmProviderName; apiKey: string; model: string }
  | undefined {
  const env = getServerEnv();
  if (env.LLM_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.LLM_MODEL || defaultModelFor("anthropic"),
    };
  }
  if (env.LLM_PROVIDER === "openai" && env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      apiKey: env.OPENAI_API_KEY,
      model: env.LLM_MODEL || defaultModelFor("openai"),
    };
  }
  return undefined;
}

function instantiateProvider(
  provider: LlmProviderName,
  apiKey: string,
  model: string,
): LlmProvider {
  return provider === "anthropic"
    ? createAnthropicProvider({ apiKey, model })
    : createOpenAiProvider({ apiKey, model });
}
