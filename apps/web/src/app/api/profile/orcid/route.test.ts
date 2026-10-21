import { beforeEach, expect, it, vi } from "vitest";
import type { z } from "zod";

const mocks = vi.hoisted(() => ({ setUserOrcid: vi.fn() }));
vi.mock("@/lib/editorial-lifecycle", () => ({ setUserOrcid: mocks.setUserOrcid }));
// Exercise this route's real request schema and callback. Authentication/CSRF
// remain the responsibility of the unchanged shared lifecycle wrapper.
vi.mock("@/lib/editorial-api", () => ({
  handleLifecyclePost: async (
    request: Request,
    schema: z.ZodTypeAny,
    handler: (actor: { id: string; role: string }, body: unknown) => Promise<unknown>,
  ) => {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });
    return Response.json(await handler({ id: "synthetic-principal", role: "USER" }, parsed.data));
  },
}));
import { POST } from "./route";

beforeEach(() => mocks.setUserOrcid.mockReset());
const request = (orcid: unknown) =>
  new Request("https://atlas.invalid/api/profile/orcid", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orcid }),
  });

it("rejects checksum-invalid manual ORCID before the lifecycle write", async () => {
  const response = await POST(request("0000-0002-1825-0098"));
  expect(response.status).toBe(400);
  expect(mocks.setUserOrcid).not.toHaveBeenCalled();
});

it("keeps successful manual entry and null clearing response shapes unverified", async () => {
  for (const orcid of ["0000-0002-1825-0097", null]) {
    const response = await POST(request(orcid));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orcid, verified: false });
    expect(mocks.setUserOrcid).toHaveBeenLastCalledWith(
      { id: "synthetic-principal", role: "USER" },
      orcid,
    );
  }
});
