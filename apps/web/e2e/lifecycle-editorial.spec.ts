import { test, expect } from "@playwright/test";

test.describe("Formal editorial lifecycle surfaces", () => {
  test("docmap export serves a DocMaps process map for a published version", async ({
    request,
  }) => {
    const detail = await request.get("/api/reviews/hippocampal-replay-computational-review");
    expect(detail.ok()).toBeTruthy();
    const review = await detail.json();
    const docmap = await request.get(
      `/api/reviews/hippocampal-replay-computational-review/versions/${review.version.id}/export/docmap`,
    );
    expect(docmap.ok()).toBeTruthy();
    const map = await docmap.json();
    expect(map["@context"]).toBe("https://w3id.org/docmaps/context.jsonld");
    expect(map.type).toBe("docmap");
    expect(map["first-step"]).toBe("_:b0");
  });

  test("notifications require a session", async ({ request }) => {
    const res = await request.get("/api/notifications");
    expect(res.status()).toBe(401);
  });

  test("lifecycle mutations refuse anonymous cross-origin requests", async ({ request }) => {
    const res = await request.post("/api/editorial/rounds", {
      data: { submissionId: "x" },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("process endpoint is public and 404s unknown submissions", async ({ request }) => {
    const res = await request.get("/api/editorial/process?submissionId=does-not-exist");
    expect(res.status()).toBe(404);
  });
});
