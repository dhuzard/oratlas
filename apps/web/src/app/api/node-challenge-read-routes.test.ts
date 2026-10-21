import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/editorial-api", () => ({ handleLifecyclePost: vi.fn() }));
vi.mock("@/lib/challenges", async () => {
  const { ChallengeError } = await import("@/lib/challenge-contract");
  return { ChallengeError, createNodeChallenge: vi.fn(), listNodeChallenges: state.read };
});
vi.mock("@/lib/node-challenge-exports", () => ({ loadNodeChallengeExport: state.read }));

import { ChallengeError } from "@/lib/challenge-contract";
import { GET as register } from "./nodes/[id]/challenges/route";
import { GET as jsonExport } from "./nodes/[id]/exports/challenges.json/route";
import { GET as crateExport } from "./nodes/[id]/exports/challenges-ro-crate/route";

const cases = [
  { name: "register", path: "challenges", get: register },
  { name: "JSON export", path: "exports/challenges.json", get: jsonExport },
  { name: "RO-Crate export", path: "exports/challenges-ro-crate", get: crateExport },
] as const;
const context = { params: Promise.resolve({ id: "synthetic-node" }) };

for (const route of cases)
  describe(`node challenge ${route.name} error boundary`, () => {
    const request = (query = "") =>
      new Request(`https://oratlas.test/api/nodes/synthetic-node/${route.path}${query}`);
    beforeEach(() => {
      state.read.mockReset();
    });

    it("returns typed400 for an invalid cursor instead of treating it as an internal failure", async () => {
      state.read.mockRejectedValue(new ChallengeError("Invalid node challenge cursor."));
      const response = await route.get(request("?cursor=not-a-challenge&limit=2"), context);
      expect(state.read).toHaveBeenCalledExactlyOnceWith("synthetic-node", "not-a-challenge", 2);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "bad-request", message: "Invalid node challenge cursor." },
      });
      expect(response.headers.get("link")).toContain('rel="service-desc"');
    });

    it.each([
      ["not-found", 404, "Knowledge node not found."],
      ["forbidden", 403, "Challenges are closed on this public container."],
      ["conflict", 409, "Challenge content projection integrity check failed."],
    ] as const)("maps the known %s domain error", async (code, status, message) => {
      state.read.mockRejectedValue(new ChallengeError(message, code));
      const response = await route.get(request(), context);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: { code, message } });
    });

    it("keeps hidden and missing nodes at the same generic404 even when a cursor is supplied", async () => {
      state.read.mockResolvedValue(null);
      const response = await route.get(request("?cursor=not-a-challenge"), context);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "not-found", message: "Knowledge node not found." },
      });
    });

    it("rejects invalid limits before storage access", async () => {
      const response = await route.get(request("?limit=101"), context);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "bad-request", message: "limit must be an integer from 1 to 100." },
      });
      expect(state.read).not.toHaveBeenCalled();
    });

    it("leaves unexpected failures at generic500 without returning internal details or duck-typed codes", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        state.read.mockRejectedValue(
          Object.assign(new Error("synthetic private database detail"), { code: "bad-request" }),
        );
        const response = await route.get(request(), context);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
          error: { code: "internal-error", message: "An unexpected error occurred." },
        });
      } finally {
        consoleError.mockRestore();
      }
    });
  });
