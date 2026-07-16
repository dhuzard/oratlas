import { describe, expect, it, vi } from "vitest";
import { createAnthropicProvider } from "./anthropic.js";

const request = {
  promptVersion: "test-1",
  system: "static system",
  user: '{"packet":"canonical"}',
  maxTokens: 321,
  maxResponseBytes: 1_024,
};

describe("Anthropic transport adapter", () => {
  it("uses request-specific prompt/limits and returns provider text without tolerant extraction", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "offline-anthropic",
        max_tokens: 321,
        system: "static system",
        messages: [{ role: "user", content: '{"packet":"canonical"}' }],
      });
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: '```json\n{"x":1}\n```' }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const provider = createAnthropicProvider({
      apiKey: "test-key",
      model: "offline-anthropic",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(provider.complete(request)).resolves.toBe('```json\n{"x":1}\n```');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects invalid token/byte limits before transport", async () => {
    const fetchImpl = vi.fn();
    const provider = createAnthropicProvider({
      apiKey: "test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(provider.complete({ ...request, maxTokens: 8_193 })).rejects.toThrow(
      "token limit",
    );
    await expect(provider.complete({ ...request, maxResponseBytes: 262_145 })).rejects.toThrow(
      "response byte limit",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on declared or streamed response overflow and malformed transport JSON", async () => {
    const cases = [
      new Response("x", { status: 200, headers: { "content-length": "2000" } }),
      new Response("x".repeat(2_000), { status: 200 }),
      new Response("not-json", { status: 200 }),
    ];
    for (const response of cases) {
      const provider = createAnthropicProvider({
        apiKey: "test",
        fetchImpl: (async () => response) as typeof fetch,
      });
      await expect(provider.complete(request)).rejects.toThrow();
    }
  });
});
