import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicationAdapterError } from "@oratlas/publications";

const state = vi.hoisted(() => ({ register: vi.fn() }));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth", () => ({
  getServerEnv: () => ({ NEXT_PUBLIC_BASE_URL: "https://atlas.example" }),
  requireEditor: async () => ({ id: "editor-1" }),
}));

vi.mock("@/lib/rate-limit", () => ({
  clientKey: () => "test:external-publication-register",
  rateLimit: () => ({ ok: true, remaining: 4, resetAt: Date.now() + 60_000 }),
}));

vi.mock("@/lib/external-publication-registration", () => ({
  PublicationRegistrationConflictError: class PublicationRegistrationConflictError extends Error {},
  registerExternalPublication: state.register,
}));

import { POST } from "./route";

function request(contentType: string, body = "{}"): Request {
  return new Request("https://atlas.example/api/editorial/publications/register", {
    method: "POST",
    headers: {
      Origin: "https://atlas.example",
      "Content-Type": contentType,
      "Sec-Fetch-Site": "same-origin",
    },
    body,
  });
}

describe("POST /api/editorial/publications/register", () => {
  beforeEach(() => state.register.mockReset());

  it("returns the documented 415 for a non-JSON request", async () => {
    const response = await POST(request("text/plain"));

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: {
        code: "unsupported-media-type",
        message: "Content-Type application/json is required.",
      },
    });
    expect(state.register).not.toHaveBeenCalled();
  });

  it("translates adapter contract failures to a sanitized 400", async () => {
    state.register.mockRejectedValueOnce(new PublicationAdapterError("invalid ordering"));
    const response = await POST(
      request(
        "application/json",
        JSON.stringify({ manifestUrl: "https://publication.example/oratlas.manifest.json" }),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "bad-request",
        message: "The external publication does not satisfy the registration contract.",
      },
    });
  });
});
