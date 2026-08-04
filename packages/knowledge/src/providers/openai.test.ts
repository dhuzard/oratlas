import { describe, expect, it, vi } from "vitest";
import { createOpenAiProvider } from "./openai.js";

const request = {
  promptVersion: "test-1",
  system: "static system",
  user: '{"packet":"canonical"}',
  maxTokens: 321,
  maxResponseBytes: 1_024,
};

describe("OpenAI transport adapter", () => {
  it("uses the Responses API contract and returns provider text", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer test-key" });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "offline-openai",
        instructions: "static system",
        input: '{"packet":"canonical"}',
        max_output_tokens: 321,
      });
      return new Response(
        JSON.stringify({
          output: [{ content: [{ type: "output_text", text: '```json\n{"x":1}\n```' }] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const provider = createOpenAiProvider({
      apiKey: "test-key",
      model: "offline-openai",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(provider.complete(request)).resolves.toBe('```json\n{"x":1}\n```');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("accepts an output_text convenience field", async () => {
    const provider = createOpenAiProvider({
      apiKey: "test",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ output_text: '{"ok":true}' }), {
          status: 200,
        })) as typeof fetch,
    });
    await expect(provider.complete(request)).resolves.toBe('{"ok":true}');
  });

  it("rejects invalid limits and malformed or oversized responses", async () => {
    const fetchImpl = vi.fn();
    const provider = createOpenAiProvider({
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

    for (const response of [
      new Response("x", { status: 200, headers: { "content-length": "2000" } }),
      new Response("x".repeat(2_000), { status: 200 }),
      new Response("not-json", { status: 200 }),
      new Response(JSON.stringify({ output: [] }), { status: 200 }),
    ]) {
      const failing = createOpenAiProvider({
        apiKey: "test",
        fetchImpl: (async () => response) as typeof fetch,
      });
      await expect(failing.complete(request)).rejects.toThrow();
    }
  });
});
