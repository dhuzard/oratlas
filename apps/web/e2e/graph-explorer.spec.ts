import AxeBuilder from "@axe-core/playwright";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { getPrisma } from "@oratlas/db";
import { publicGraphResponseSchema, publicNodeListResponseSchema } from "@oratlas/contracts";

const prisma = getPrisma();

test("confirmed graph navigation exposes contradiction from both exact-version endpoints", async ({
  page,
  request,
}) => {
  const contradiction = await discoverEdge(request, "confirmed", "contradicts");
  for (const nodeId of [contradiction.sourceNodeId, contradiction.targetNodeId]) {
    await page.goto(graphUrl(nodeId, { relationType: "contradicts" }));
    await expect(page.locator(".graph-edge").getByText("Confirmed", { exact: true })).toBeVisible();
    await expect(page.locator(".graph-edge .badge-warning")).toContainText("contradicts");
    await expect(page.locator(".graph-edge-contradicts")).toHaveCount(1);
    const relation = page.locator(".graph-edge-contradicts");
    await expect(
      relation.locator(
        `a[href="/nodes/${contradiction.sourceNodeId}/versions/${contradiction.sourceVersionId}"]`,
      ),
    ).toBeVisible();
    await expect(
      relation.locator(
        `a[href="/nodes/${contradiction.targetNodeId}/versions/${contradiction.targetVersionId}"]`,
      ),
    ).toBeVisible();
  }
});

test("proposals are visibly distinct and remain privacy-minimal", async ({ page, request }) => {
  const proposal = await discoverEdge(request, "proposed");
  await page.goto(graphUrl(proposal.sourceNodeId, { edgeStatus: "proposed" }));
  await expect(page.locator(".graph-edge").getByText("Proposed", { exact: true })).toBeVisible();
  await expect(page.locator(".graph-edge-proposed")).toHaveCSS("border-top-style", "dashed");
  const api = await request.get(
    `/api/graph?seed=${encodeURIComponent(proposal.sourceNodeId)}&edgeStatus=proposed&depth=1&limit=50`,
  );
  const serialized = JSON.stringify(await api.json());
  for (const forbidden of [
    "evidenceJson",
    "agentRun",
    "reviewNote",
    "reviewedBy",
    "audit",
    "rejected",
    "superseded",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
});

test("filters and signed cursor pagination preserve their query", async ({ page, request }) => {
  const candidate = await discoverPaginatedNode(request);
  await page.goto(graphUrl(candidate, { limit: "1", relationType: "uses-dataset" }));
  // A relation filter may reduce the page to one without a cursor; first verify filter rendering.
  await expect(page.locator("#graph-relation")).toHaveValue("uses-dataset");
  await page.goto(graphUrl(candidate, { limit: "1" }));
  const next = page.getByRole("link", { name: "Next page" });
  await expect(next).toBeVisible();
  await Promise.all([page.waitForURL(/cursor=/), next.click()]);
  expect(page.url()).toContain("cursor=");
  expect(page.url()).toContain("seed=");
  expect(page.url()).toContain("limit=1");
  await expect(page.getByRole("link", { name: "First page" })).toBeVisible();
});

test("keyboard navigation opens an immutable node version", async ({ page, request }) => {
  const edge = await discoverEdge(request, "confirmed");
  await page.goto(graphUrl(edge.sourceNodeId));
  const exact = page
    .locator(`a[href="/nodes/${edge.sourceNodeId}/versions/${edge.sourceVersionId}"]`)
    .first();
  await exact.focus();
  await expect(exact).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    new RegExp(`/nodes/${edge.sourceNodeId}/versions/${edge.sourceVersionId}$`),
  );
});

test("graph is accessible on a narrow viewport and example DOI is never linked", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const dataset = await discoverNode(request, "dataset");
  await page.goto(graphUrl(dataset.id));
  await expect(page.getByText("example — not linked").first()).toBeVisible();
  await expect(page.locator('a[href^="https://doi.org/"]')).toHaveCount(0);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 360);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    blocking,
    blocking.map((violation) => `${violation.id}: ${violation.help}`).join("\n"),
  ).toEqual([]);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("authoritative relations, filters, and pagination are server rendered", async ({
    page,
    request,
  }) => {
    const candidate = await discoverPaginatedNode(request);
    await page.goto(graphUrl(candidate, { limit: "1" }));
    await expect(page.getByRole("list", { name: "Authoritative graph relations" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Next page" })).toBeVisible();
  });
});

test.describe("hostile stored text", () => {
  const ids = {
    node: "kg09-hostile-node",
    version: "kg09-hostile-version",
    edge: "kg09-hostile-edge",
  };
  const hostile = `<script>private-token</script><img src=x onerror=alert(1)>`;

  test.beforeAll(async () => {
    const target = await prisma.knowledgeNode.findFirstOrThrow({
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 }, repository: true },
    });
    const snapshot = await prisma.repositorySnapshot.findFirstOrThrow({
      where: { repositoryId: target.repositoryId },
    });
    const editor = await prisma.user.findFirstOrThrow({ where: { role: "EDITOR" } });
    await prisma.knowledgeNode.create({
      data: {
        id: ids.node,
        repositoryId: target.repositoryId,
        localNodeId: ids.node,
        kind: "claim",
      },
    });
    await prisma.knowledgeNodeVersion.create({
      data: {
        id: ids.version,
        knowledgeNodeId: ids.node,
        snapshotId: snapshot.id,
        title: hostile,
        contributorsJson: "[]",
        license: "CC-BY-4.0",
        provenanceJson: JSON.stringify({ sourcePath: "nodes/hostile.json" }),
        payloadJson: JSON.stringify({ statement: hostile, qualifiers: [] }),
      },
    });
    await prisma.nodeEdge.create({
      data: {
        id: ids.edge,
        sourceNodeVersionId: ids.version,
        targetNodeId: target.id,
        relationType: "supports",
        status: "confirmed",
        provenance: "confirmed-by-editor",
        confirmedTargetNodeVersionId: target.versions[0]!.id,
        confirmedById: editor.id,
        confirmedAt: new Date("2026-07-16T00:00:00.000Z"),
        rationale: hostile,
      },
    });
  });

  test.afterAll(async () => {
    await prisma.nodeEdge.deleteMany({ where: { id: ids.edge } });
    await prisma.knowledgeNodeVersion.deleteMany({ where: { knowledgeNodeId: ids.node } });
    await prisma.knowledgeNode.deleteMany({ where: { id: ids.node } });
  });

  test("React escapes hostile titles and rationales into inert text", async ({ page }) => {
    await page.goto(graphUrl(ids.node));
    await expect(page.getByText(hostile).first()).toBeVisible();
    await expect(page.locator("script").filter({ hasText: "private-token" })).toHaveCount(0);
    await expect(page.locator("img")).toHaveCount(0);
  });
});

function graphUrl(seed: string, changes: Record<string, string> = {}) {
  return `/graph?${new URLSearchParams({ seed, depth: "1", limit: "50", edgeStatus: "confirmed", ...changes })}`;
}

async function discoverNode(request: APIRequestContext, kind: "claim" | "dataset") {
  const response = await request.get(`/api/nodes?kind=${kind}&pageSize=50`);
  expect(response.ok()).toBeTruthy();
  return publicNodeListResponseSchema.parse(await response.json()).items[0]!;
}

async function discoverEdge(
  request: APIRequestContext,
  status: "confirmed" | "proposed",
  relationType?: "contradicts",
) {
  const nodesResponse = await request.get("/api/nodes?pageSize=50");
  const nodes = publicNodeListResponseSchema.parse(await nodesResponse.json()).items;
  for (const node of nodes) {
    const params = new URLSearchParams({
      seed: node.id,
      depth: "1",
      limit: "50",
      edgeStatus: status,
    });
    if (relationType) params.set("relationType", relationType);
    const response = await request.get(`/api/graph?${params}`);
    if (!response.ok()) continue;
    const result = publicGraphResponseSchema.parse(await response.json());
    if (result.edges[0]) return result.edges[0];
  }
  throw new Error(`Seed data has no ${status} ${relationType ?? ""} edge`);
}

async function discoverPaginatedNode(request: APIRequestContext) {
  const nodesResponse = await request.get("/api/nodes?pageSize=50");
  const nodes = publicNodeListResponseSchema.parse(await nodesResponse.json()).items;
  for (const node of nodes) {
    const response = await request.get(
      `/api/graph?seed=${encodeURIComponent(node.id)}&depth=1&limit=1`,
    );
    if (!response.ok()) continue;
    const result = publicGraphResponseSchema.parse(await response.json());
    if (result.page.nextCursor) return node.id;
  }
  throw new Error("Seed data has no graph node with multiple relations");
}
