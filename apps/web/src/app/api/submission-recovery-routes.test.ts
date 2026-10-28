import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  inspect: vi.fn(),
  capture: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getServerEnv: () => ({ NEXT_PUBLIC_BASE_URL: "https://atlas.example" }),
  requireUser: vi.fn().mockResolvedValue({ id: "signed-in-owner" }),
}));
vi.mock("@/lib/submissions", async () => ({
  ...(await import("@/lib/submission-contract")),
  createSubmission: mocks.create,
}));
vi.mock("@/lib/ingest", () => ({
  inspectAndExtract: mocks.inspect,
  buildValidationReport: vi.fn(),
  normalizeRepoUrl: vi
    .fn()
    .mockReturnValue({ ok: false, reason: "Only public GitHub repositories are supported." }),
}));
vi.mock("@/lib/inspection-captures", () => ({ createInspectionCapture: mocks.capture }));
vi.mock("@/lib/rate-limit", () => ({
  clientKey: (_headers: Headers, suffix: string) => suffix,
  rateLimit: mocks.limit,
}));

import { POST as submit } from "./submissions/route";
import { POST as inspect } from "./inspect/route";
import { SubmissionError } from "@/lib/submission-contract";

function request(path: string, body: unknown) {
  return new Request(`https://atlas.example/api/${path}`, {
    method: "POST",
    headers: { Origin: "https://atlas.example", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("supported deposit recovery HTTP boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.limit.mockReturnValue({ ok: true });
  });

  it("rate-limits inspection and finalization before any capture or submission work", async () => {
    mocks.limit.mockReturnValue({ ok: false });
    const a = await inspect(
      request("inspect", {
        url: "https://github.com/lab/review",
        source: { kind: "default-branch" },
      }),
    );
    const b = await submit(request("submissions", { inspectionToken: "a".repeat(43) }));
    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
    expect(mocks.limit).toHaveBeenCalledWith("inspect:signed-in-owner", 20, 60_000);
    expect(mocks.limit).toHaveBeenCalledWith("submit:signed-in-owner", 10, 60_000);
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps attention-needed submissions valid and uses authenticated ownership", async () => {
    mocks.create.mockResolvedValue({
      submissionId: "submitted-exact-capture",
      status: "automated-checks-failed",
    });
    const response = await submit(
      request("submissions", { inspectionToken: "a".repeat(43), submitterId: "forged-owner" }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      submissionId: "submitted-exact-capture",
      status: "automated-checks-failed",
    });
    expect(mocks.create).toHaveBeenCalledWith({
      inspectionToken: "a".repeat(43),
      submitterId: "signed-in-owner",
      editedMetadata: undefined,
    });
  });

  it.each([
    ["bad-request", "Inspection capability expired; inspect again.", 400],
    ["conflict", "Inspection capability belongs to another user.", 409],
    ["conflict", "Inspection capability has already been consumed.", 409],
  ] as const)(
    "preserves %s recovery error without inventing a new capture",
    async (code, message, status) => {
      mocks.create.mockRejectedValue(new SubmissionError(message, code));
      const response = await submit(request("submissions", { inspectionToken: "a".repeat(43) }));
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code, message } });
      expect(mocks.capture).not.toHaveBeenCalled();
      expect(mocks.inspect).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed metadata before finalization", async () => {
    const response = await submit(
      request("submissions", {
        inspectionToken: "a".repeat(43),
        editedMetadata: { edits: "not-an-edit-map" },
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
