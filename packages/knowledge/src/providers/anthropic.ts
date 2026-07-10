import { type EvidencePacket } from "@oratlas/contracts";
import { buildDiscussionPrompt, DISCUSSION_PROMPT_VERSION, type LlmProvider } from "../discuss.js";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Anthropic adapter behind the provider-neutral `LlmProvider` interface. This
 * is the ONLY place the concrete provider is referenced; swapping providers
 * means adding another adapter, not touching discussion logic. The model
 * receives only the evidence packet and is asked for a single JSON object.
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
    promptVersion: DISCUSSION_PROMPT_VERSION,
    async complete(packet: EvidencePacket): Promise<string> {
      const { system, user } = buildDiscussionPrompt(packet);
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
            max_tokens: 1500,
            system,
            messages: [
              {
                role: "user",
                content: `Evidence packet (JSON). Answer the question inside it.\n\n${user}`,
              },
            ],
          }),
        });
        if (!res.ok) {
          throw new Error(`Anthropic API returned ${res.status}.`);
        }
        const json = (await res.json()) as {
          content?: Array<{ type: string; text?: string }>;
        };
        const text = json.content?.find((c) => c.type === "text")?.text ?? "";
        return extractJsonObject(text);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Extract the first top-level JSON object from model text, tolerating fences. */
export function extractJsonObject(text: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fence ? fence[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return candidate.trim();
  return candidate.slice(start, end + 1);
}
