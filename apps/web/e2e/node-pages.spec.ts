import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  publicNodeDetailSchema,
  publicNodeListResponseSchema,
  publicNodeVersionListResponseSchema,
} from "@oratlas/contracts";

test("claim node exposes confirmed edges, scoped TRUST context, and immutable history", async ({
  page,
  request,
}) => {
  const claim = await discoverClaimWithTrust(request);
  await page.goto(`/nodes/${claim.id}`);

  await expect(page.getByRole("heading", { level: 1, name: claim.title })).toBeVisible();
  await expect(page.getByText("Only editor-confirmed relations are public here.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Confirmed graph relations/ })).toBeVisible();
  await expect(
    page.getByText("TRUST belongs to each exact claim–citation relation."),
  ).toBeVisible();
  await expect(page.getByText(/relation aggregate/).first()).toBeVisible();

  const detailResponse = await request.get(`/api/nodes/${claim.id}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = publicNodeDetailSchema.parse(await detailResponse.json());
  expect(detail.id).toBe(claim.id);
  expect(detail.edges.every((edge) => edge.provenance !== "proposed-by-agent")).toBe(true);

  const historyResponse = await request.get(`/api/nodes/${claim.id}/versions`);
  const history = publicNodeVersionListResponseSchema.parse(await historyResponse.json());
  const selected = history.items[0]!;
  await page.goto(`/nodes/${claim.id}/versions/${selected.id}`);
  await expect(page.getByText("Historical immutable version")).toBeVisible();
  await expect(page.getByText(selected.commitSha)).toBeVisible();
});

test("dataset node marks each example DOI without a resolver or JSON-LD identifier", async ({
  page,
  request,
}) => {
  const dataset = await discoverNode(request, "dataset");
  await page.goto(`/nodes/${dataset.id}`);

  await expect(page.getByRole("heading", { level: 1, name: dataset.title })).toBeVisible();
  await expect(page.getByText("Dataset content")).toBeVisible();
  const exampleValues = page.locator("dd").filter({ hasText: "10.5555/" });
  await expect(exampleValues.first()).toContainText("example — not linked");
  await expect(exampleValues.locator('a[href^="https://doi.org/"]')).toHaveCount(0);
  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  expect(jsonLd).not.toContain("10.5555/");
});

test("node API validates kind filters and uses dynamically discovered database ids", async ({
  request,
}) => {
  const bad = await request.get("/api/nodes?kind=paper");
  expect(bad.status()).toBe(400);
  const dataset = await discoverNode(request, "dataset");
  expect(dataset.id).not.toBe(dataset.localNodeId);
});

async function discoverNode(request: APIRequestContext, kind: "claim" | "dataset") {
  const response = await request.get(`/api/nodes?kind=${kind}&pageSize=50`);
  expect(response.ok()).toBeTruthy();
  const list = publicNodeListResponseSchema.parse(await response.json());
  expect(list.items.length).toBeGreaterThan(0);
  return list.items[0]!;
}

async function discoverClaimWithTrust(request: APIRequestContext) {
  const response = await request.get("/api/nodes?kind=claim&pageSize=50");
  expect(response.ok()).toBeTruthy();
  const list = publicNodeListResponseSchema.parse(await response.json());

  for (const candidate of list.items) {
    const detailResponse = await request.get(`/api/nodes/${candidate.id}`);
    if (!detailResponse.ok()) continue;
    const detail = publicNodeDetailSchema.parse(await detailResponse.json());
    if (detail.trustContext.length > 0) return candidate;
  }

  throw new Error("Seed data did not expose a claim with relation-scoped TRUST context");
}
