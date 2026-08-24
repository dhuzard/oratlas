import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorized: false,
  createAssertion: vi.fn(),
  createRelation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => {
  class AuthError extends Error {
    constructor(
      message: string,
      public readonly status = 401,
    ) {
      super(message);
    }
  }
  return {
    AuthError,
    getServerEnv: () => ({ NEXT_PUBLIC_BASE_URL: "https://atlas.example" }),
    requireEditor: async () => {
      if (!state.authorized) throw new AuthError("Sign in required.");
      return { id: "editor-1", role: "EDITOR" };
    },
  };
});
vi.mock("@/lib/publication-provenance", () => ({
  PublicationProvenanceError: class PublicationProvenanceError extends Error {},
  createPublicationProductionAssertion: state.createAssertion,
  createPublicationRelation: state.createRelation,
}));

import { POST as assertProduction } from "./publication-versions/[id]/production-provenance/route";
import { POST as relatePublication } from "./publications/[id]/relations/route";

function request(path: string, body: unknown): Request {
  return new Request(`https://atlas.example${path}`, {
    method: "POST",
    headers: {
      Origin: "https://atlas.example",
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

describe("editorial publication provenance routes", () => {
  beforeEach(() => {
    state.authorized = false;
    state.createAssertion.mockReset();
    state.createRelation.mockReset();
  });

  it("does not let an anonymous source append production provenance", async () => {
    const response = await assertProduction(
      request("/api/editorial/publication-versions/version-1/production-provenance", {
        mode: "human",
        actors: [],
        activities: ["authoring"],
        strength: "source-declared",
      }),
      { params: Promise.resolve({ id: "version-1" }) },
    );
    expect(response.status).toBe(401);
    expect(state.createAssertion).not.toHaveBeenCalled();
  });

  it("does not let an anonymous source create publication continuity", async () => {
    const response = await relatePublication(
      request("/api/editorial/publications/publication-1/relations", {
        targetPublicationId: "publication-2",
        relationType: "moved-to",
        rationale: "A sufficiently long but unauthenticated relationship rationale.",
      }),
      { params: Promise.resolve({ id: "publication-1" }) },
    );
    expect(response.status).toBe(401);
    expect(state.createRelation).not.toHaveBeenCalled();
  });
});
