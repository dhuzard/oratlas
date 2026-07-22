import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  allowed: true,
  requireUser: vi.fn(),
  createChallenge: vi.fn(),
  transitionChallenge: vi.fn(),
  createChallengeResponse: vi.fn(),
  removeChallengeContent: vi.fn(),
  removeChallengeResponseContent: vi.fn(),
  rateLimit: vi.fn(),
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
    requireUser: state.requireUser,
  };
});
vi.mock("@/lib/challenges", () => ({
  ChallengeError: class ChallengeError extends Error {
    code = "conflict" as const;
  },
  createChallenge: state.createChallenge,
  listChallenges: vi.fn(),
  transitionChallenge: state.transitionChallenge,
  createChallengeResponse: state.createChallengeResponse,
  removeChallengeContent: state.removeChallengeContent,
  removeChallengeResponseContent: state.removeChallengeResponseContent,
}));
vi.mock("@/lib/rate-limit", () => ({
  clientKey: (_headers: Headers, suffix: string) => `test:${suffix}`,
  rateLimitDefaults: () => ({ max: 10, windowMs: 60_000 }),
  rateLimit: (...args: unknown[]) => {
    state.rateLimit(...args);
    return { ok: state.allowed, remaining: state.allowed ? 9 : 0, resetAt: Date.now() + 60_000 };
  },
}));

import { MAX_BODY_BYTES } from "@/lib/api";
import { POST as fileChallenge } from "./reviews/[slug]/versions/[versionId]/challenges/route";
import { POST as transitionChallenge } from "./challenges/[id]/transitions/route";
import { POST as respondToChallenge } from "./challenges/[id]/responses/route";
import { POST as moderateChallenge } from "./challenges/[id]/moderation/route";
import { POST as moderateResponse } from "./challenge-responses/[id]/moderation/route";

const actor = {
  id: "actor-1",
  githubLogin: "actor",
  displayName: null,
  avatarUrl: null,
  profileUrl: null,
  role: "USER" as const,
};

const cases = [
  {
    name: "file",
    suffix: "challenge:file:version-1",
    body: {
      reviewVersionId: "version-1",
      subject: { type: "claim", claimId: "claim-1" },
      canonicalSubjectHash: "a".repeat(64),
      grounds: "methodology",
      body: "Exact challenge grounds.",
    },
    domain: state.createChallenge,
    invoke: (request: Request) =>
      fileChallenge(request, {
        params: Promise.resolve({ slug: "review", versionId: "version-1" }),
      }),
  },
  {
    name: "transition",
    suffix: "challenge:transition:challenge-1",
    body: { expectedRevision: 1, toStatus: "resolved", rationale: "Editorial outcome." },
    domain: state.transitionChallenge,
    invoke: (request: Request) =>
      transitionChallenge(request, { params: Promise.resolve({ id: "challenge-1" }) }),
  },
  {
    name: "response",
    suffix: "challenge:response:challenge-1",
    body: { expectedRevision: 0, body: "Contributor response." },
    domain: state.createChallengeResponse,
    invoke: (request: Request) =>
      respondToChallenge(request, { params: Promise.resolve({ id: "challenge-1" }) }),
  },
  {
    name: "challenge moderation",
    suffix: "challenge:moderate:challenge-1",
    body: { expectedContentRevision: 0 },
    domain: state.removeChallengeContent,
    invoke: (request: Request) =>
      moderateChallenge(request, { params: Promise.resolve({ id: "challenge-1" }) }),
  },
  {
    name: "response moderation",
    suffix: "challenge:response-moderate:response-1",
    body: { expectedContentRevision: 0 },
    domain: state.removeChallengeResponseContent,
    invoke: (request: Request) =>
      moderateResponse(request, { params: Promise.resolve({ id: "response-1" }) }),
  },
] as const;

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://atlas.example/api/challenges/test", {
    method: "POST",
    headers: {
      Origin: "https://atlas.example",
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("formal challenge mutation route boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.allowed = true;
    state.requireUser.mockResolvedValue(actor);
    for (const route of cases) route.domain.mockResolvedValue({ ok: true });
  });

  for (const route of cases) {
    it(`rejects cross-origin ${route.name} before authentication or domain work`, async () => {
      const response = await route.invoke(
        request(route.body, { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }),
      );
      expect(response.status).toBe(403);
      expect(state.requireUser).not.toHaveBeenCalled();
      expect(route.domain).not.toHaveBeenCalled();
    });

    it(`requires authentication and applies a route-scoped rate limit for ${route.name}`, async () => {
      state.allowed = false;
      const response = await route.invoke(request(route.body));
      expect(response.status).toBe(429);
      expect(state.requireUser).toHaveBeenCalledOnce();
      expect(state.rateLimit).toHaveBeenCalledWith(`test:${route.suffix}:actor-1`, 10, 60_000);
      expect(route.domain).not.toHaveBeenCalled();
    });

    it(`rejects an oversized ${route.name} body before domain work`, async () => {
      const response = await route.invoke(
        request(route.body, { "Content-Length": String(MAX_BODY_BYTES + 1) }),
      );
      expect(response.status).toBe(413);
      expect(route.domain).not.toHaveBeenCalled();
    });
  }
});
