import { Buffer } from "node:buffer";
import { type LlmProvider } from "../discuss.js";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const MAX_PROVIDER_TOKENS = 8_192;
const MAX_PROVIDER_RESPONSE_BYTES = 262_144;

/**
 * Anthropic adapter behind the provider-neutral `LlmProvider` interface. This
 * is the ONLY place the concrete provider is referenced; swapping providers
 * means adding another adapter, not touching discussion logic. The model
 * Request-specific prompts and limits are supplied by the caller. This adapter
 * only performs bounded transport and returns the provider text verbatim.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): LlmProvider {
  const {
    apiKey,
    model = "claude-sonnet-5",
    baseUrl = "https://api.anthropic.com",
    fetchImpl = fetch,
    timeoutMs = 30_000,
  } = options;

  return {
    name: "anthropic",
    model,
    async complete(request): Promise<string> {
      if (
        !Number.isInteger(request.maxTokens) ||
        request.maxTokens < 1 ||
        request.maxTokens > MAX_PROVIDER_TOKENS
      ) {
        throw new Error("LLM token limit is invalid.");
      }
      if (
        !Number.isInteger(request.maxResponseBytes) ||
        request.maxResponseBytes < 1 ||
        request.maxResponseBytes > MAX_PROVIDER_RESPONSE_BYTES
      ) {
        throw new Error("LLM response byte limit is invalid.");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${baseUrl}/v1/messages`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: [
              {
                role: "user",
                content: request.user,
              },
            ],
          }),
        });
        if (!res.ok) {
          throw new Error(`Anthropic API returned ${res.status}.`);
        }
        const responseText = await readBoundedResponse(res, request.maxResponseBytes);
        let json: {
          content?: Array<{ type: string; text?: string }>;
        };
        try {
          json = JSON.parse(responseText) as typeof json;
        } catch {
          throw new Error("Anthropic API returned invalid JSON.");
        }
        const text = json.content?.find((c) => c.type === "text")?.text ?? "";
        if (Buffer.byteLength(text, "utf8") > request.maxResponseBytes) {
          throw new Error("Anthropic completion exceeded the response byte limit.");
        }
        return text;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Anthropic response exceeded the response byte limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("Anthropic response exceeded the response byte limit.");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}
