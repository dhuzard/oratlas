import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@oratlas/config";

const state = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sitemap-records", () => ({ listSitemapRecords: state.list }));

import sitemap from "./sitemap";

describe("sitemap metadata", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://atlas.example");
    resetServerEnvCache();
    state.list.mockReset();
  });

  it("turns relative records into canonical URLs without inventing static timestamps", async () => {
    const lastModified = new Date("2026-07-01T12:00:00.000Z");
    state.list.mockResolvedValue([
      { path: "/" },
      { path: "/reviews/example/versions/v1", lastModified },
    ]);

    await expect(sitemap()).resolves.toEqual([
      { url: "https://atlas.example/" },
      { url: "https://atlas.example/reviews/example/versions/v1", lastModified },
    ]);
  });
});
