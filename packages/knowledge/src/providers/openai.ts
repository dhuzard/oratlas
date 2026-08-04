import { Buffer } from "node:buffer";
import { type LlmProvider } from "../discuss.js";

export interface OpenAiProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const MAX_PROVIDER_TOKENS = 8_192;
const MAX_PROVIDER_RESPONSE_BYTES = 262_144;

/**
 * OpenAI Responses API adapter behind the provider-neutral `LlmProvider`
 * contract. Request-specific prompts and limits are supplied by the caller;
 * this module performs bounded transport and returns provider text verbatim.
 */
export function createOpenAiProvider(options: OpenAiProviderOptions): LlmProvider {
  const {
    apiKey,
    model = "gpt-5",
    baseUrl = "https://api.openai.com",
    fetchImpl = fetch,
    timeoutMs = 30_000,
  } = options;

  return {
    name: "openai",
    model,
    async complete(request): Promise<string> {
      validateLimits(request.maxTokens, request.maxResponseBytes);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}/v1/responses`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            instructions: request.system,
            input: request.user,
            max_output_tokens: request.maxTokens,
          }),
        });
        if (!response.ok) throw new Error(`OpenAI API returned ${response.status}.`);

        const responseText = await readBoundedResponse(response, request.maxResponseBytes);
        let json: unknown;
        try {
          json = JSON.parse(responseText) as unknown;
        } catch {
          throw new Error("OpenAI API returned invalid JSON.");
        }
        const text = responseOutputText(json);
        if (Buffer.byteLength(text, "utf8") > request.maxResponseBytes) {
          throw new Error("OpenAI completion exceeded the response byte limit.");
        }
        return text;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function validateLimits(maxTokens: number, maxResponseBytes: number): void {
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_PROVIDER_TOKENS) {
    throw new Error("LLM token limit is invalid.");
  }
  if (
    !Number.isInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    throw new Error("LLM response byte limit is invalid.");
  }
}

function responseOutputText(value: unknown): string {
  if (!value || typeof value !== "object") {
    throw new Error("OpenAI API response did not contain text output.");
  }
  const root = value as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  };
  if (typeof root.output_text === "string") return root.output_text;
  const texts = (root.output ?? []).flatMap((item) =>
    (item.content ?? []).flatMap((part) =>
      (part.type === "output_text" || part.type === "text") && typeof part.text === "string"
        ? [part.text]
        : [],
    ),
  );
  if (texts.length === 0) throw new Error("OpenAI API response did not contain text output.");
  return texts.join("");
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("OpenAI response exceeded the response byte limit.");
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
      throw new Error("OpenAI response exceeded the response byte limit.");
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
