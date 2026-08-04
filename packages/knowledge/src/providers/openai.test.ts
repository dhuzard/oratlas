import { describe, expect, it, vi } from "vitest";
import { createOpenAIProvider } from "./openai.js";

const request = {
  promptVersion: "test-1",
  system: "static system",
  user: '{"packet":"canonical"}',
  maxTokens: 321,
  maxResponseBytes: 1_024,
};

describe("OpenAI transport adapter", () => {
  it("uses the Responses API without storage and aggregates output text", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer test-key" });
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "offline-openai",
        instructions: "static system",
        input: '{"packet":"canonical"}',
        max_output_tokens: 321,
        store: false,
      });
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                { type: "output_text", text: '{"x":' },
                { type: "output_text", text: "1}" },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const provider = createOpenAIProvider({
      apiKey: "test-key",
      model: "offline-openai",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(provider.complete(request)).resolves.toBe('{"x":1}');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects invalid token/byte limits before transport", async () => {
    const fetchImpl = vi.fn();
    const provider = createOpenAIProvider({
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

  it("fails closed on provider errors, overflow, and malformed transport JSON", async () => {
    const cases = [
      new Response("denied", { status: 401 }),
      new Response("x", { status: 200, headers: { "content-length": "2000" } }),
      new Response("x".repeat(2_000), { status: 200 }),
      new Response("not-json", { status: 200 }),
    ];
    for (const response of cases) {
      const provider = createOpenAIProvider({
        apiKey: "test",
        fetchImpl: (async () => response) as typeof fetch,
      });
      await expect(provider.complete(request)).rejects.toThrow();
    }
  });
});
