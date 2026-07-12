import { test, expect } from "@playwright/test";

test.describe("Preservation & standards exports", () => {
  test("version exports are served from the archive with correct types", async ({ request }) => {
    const detail = await request.get("/api/reviews/hippocampal-replay-computational-review");
    expect(detail.ok()).toBeTruthy();
    const review = await detail.json();
    const versionId: string = review.version.id;
    const base = `/api/reviews/hippocampal-replay-computational-review/versions/${versionId}`;

    const bib = await request.get(`${base}/export/bibtex`);
    expect(bib.ok()).toBeTruthy();
    expect(bib.headers()["content-type"]).toContain("application/x-bibtex");
    const bibBody = await bib.text();
    expect(bibBody).toContain("@misc{");
    // Seeded DOIs are synthetic examples and must never be exported as
    // machine-actionable identifiers.
    expect(bibBody).not.toContain("doi = {");

    const crate = await request.get(`${base}/export/ro-crate`);
    expect(crate.ok()).toBeTruthy();
    const crateJson = await crate.json();
    expect(crateJson["@context"]).toBe("https://w3id.org/ro/crate/1.1/context");
    expect(JSON.stringify(crateJson)).not.toContain("doi.org/10.5555");

    const manifest = await request.get(`${base}/export/package`);
    expect(manifest.ok()).toBeTruthy();
    const manifestJson = await manifest.json();
    expect(manifestJson.schemaVersion).toBe("1.0.0");
    expect(manifestJson.integrity.snapshotContentHash).toMatch(/^[0-9a-f]{64}$/);

    const unknown = await request.get(`${base}/export/unknown-format`);
    expect(unknown.status()).toBe(404);
  });

  test("atom feed lists accepted reviews", async ({ request }) => {
    const feed = await request.get("/api/feeds/atom");
    expect(feed.ok()).toBeTruthy();
    expect(feed.headers()["content-type"]).toContain("application/atom+xml");
    const xml = await feed.text();
    expect(xml).toContain(`<feed xmlns="http://www.w3.org/2005/Atom">`);
    expect(xml).toContain("Hippocampal Replay");
  });

  test("version page offers preservation and export links", async ({ page }) => {
    await page.goto("/reviews/hippocampal-replay-computational-review");
    await expect(page.getByRole("heading", { name: "Preservation & exports" })).toBeVisible();
    await expect(page.getByRole("link", { name: "BibTeX" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Preservation manifest" })).toBeVisible();
  });
});
