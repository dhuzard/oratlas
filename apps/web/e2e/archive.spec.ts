import { test, expect } from "@playwright/test";

test.describe("Public archive browsing", () => {
  test("home page lists recently accepted reviews", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "The arXiv for AI-generated scientific reviews",
    );
    const primaryNavigation = page.getByRole("navigation", { name: "Primary" });
    await expect(primaryNavigation.getByRole("link", { name: "Reviews" })).toHaveAttribute(
      "href",
      "/archive",
    );
    await expect(primaryNavigation.getByRole("link", { name: "Explore evidence" })).toHaveAttribute(
      "href",
      "/explore",
    );
    await expect(primaryNavigation.getByRole("link", { name: "Compare" })).toHaveAttribute(
      "href",
      "/compare",
    );
    await expect(primaryNavigation.getByRole("link", { name: "Create & deposit" })).toHaveAttribute(
      "href",
      "/create-review",
    );
    await expect(primaryNavigation.getByRole("link", { name: "Graph" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Hippocampal Replay/ }).first()).toBeVisible();
  });

  test("Explore is a traversal surface with separate exhaustive indexes", async ({ page }) => {
    await page.goto("/explore");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Traverse the evidence graph");
    await expect(page.locator(".explore-results")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Discuss the selected path with Atlas" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Your question")).toHaveCount(0);
    const indexes = page.getByRole("region", { name: "Need an exhaustive record list?" });
    await expect(indexes.getByRole("link", { name: "Open claim explorer" })).toHaveAttribute(
      "href",
      "/claims",
    );
    await expect(indexes.getByRole("link", { name: "Open archive" })).toHaveAttribute(
      "href",
      "/archive",
    );
  });

  test("a known set alone does not silently create a traversed or discussion scope", async ({
    page,
  }) => {
    await page.goto("/explore?known=known-node-without-entry");

    await expect(
      page.getByRole("heading", { name: "Choose a topic, interest, or filter" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Knowledge landscape details" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("heading", { name: "Discuss the selected path with Atlas" }),
    ).toHaveCount(0);
  });

  test("first-time readers search deposited reviews before entering specialist tools", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "The arXiv for AI-generated scientific reviews.",
    );

    await page.getByLabel("Search reviews, topics, or authors").fill("replay");
    await page.getByRole("button", { name: "Search the review archive" }).click();
    await expect(page).toHaveURL(/\/archive\?.*contentType=review/);
    await expect(page).toHaveURL(/q=replay/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI review archive");
    await expect(page.getByRole("link", { name: /Hippocampal Replay/ }).first()).toBeVisible();
  });

  test("authors understand the Allen generation to ORAtlas deposit handoff", async ({ page }) => {
    await page.goto("/create-review");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Create an AI review, then deposit it",
    );
    await expect(page.getByRole("heading", { name: "Allen AIreview workflow" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Open Review Atlas" })).toBeVisible();
    await expect(page.getByText("21 gated phases")).toBeVisible();
    await expect(page.getByRole("link", { name: "Deposit a review" })).toHaveAttribute(
      "href",
      "/submit",
    );
  });

  test("readers can compare claim, evidence and TRUST coverage", async ({ page }) => {
    await page.goto("/compare");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Compare reviews, evidence and TRUST",
    );
    await expect(page.getByText("Coverage, not a leaderboard")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /VIP Cortical Interneurons/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /OpenScope Predictive Processing/i }).first(),
    ).toBeVisible();
    await expect(page.getByText("TRUST records", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Inspect claim passport" }).first()).toBeVisible();
  });

  test("Atlas Discuss is a bounded lens after the traversable graph", async ({ page }) => {
    await page.goto("/explore?q=replay");
    await expect(
      page.getByRole("heading", { name: "Discuss the selected path with Atlas" }),
    ).toBeVisible();
    await expect(page.locator(".explore-ai-landscape + .explore-ai-discuss")).toHaveCount(1);
    await expect(page.getByLabel("Your question")).toHaveValue("replay");
    const scope = page.getByLabel("Atlas Discuss evidence scope");
    await expect(scope).toContainText(/\d+ exact graph occurrences? · \d+ visible edges?/);
    await expect(scope).toContainText(/only these signed, exact node versions and visible edges/i);

    await page.getByRole("button", { name: "Ask question" }).click();
    await expect(page.locator(".atlas-discuss-resolved-scope")).toContainText(
      /\d+ exact graph occurrences? · \d+ visible edges?/i,
    );
    await expect(page.getByTestId("discussion-packet-hash")).toHaveText(/^[a-f0-9]{64}$/);
  });

  test("readers can build a personalized graph path from an explicit topic and interest", async ({
    page,
  }) => {
    await page.goto("/explore");
    await page.getByLabel("Topic or question").fill("replay");
    await page.getByRole("checkbox", { name: /Data & code/ }).check();
    await page.getByRole("button", { name: "Show my knowledge path" }).click();

    await expect(page).toHaveURL(/q=replay/);
    await expect(page).toHaveURL(/interest=data-code/);
    const landscape = page.getByRole("region", { name: "Guided knowledge landscape" });
    await expect(landscape.getByRole("heading", { level: 2 })).toContainText("replay");
    await expect(
      landscape.getByRole("heading", { name: "Nodes worth exploring for this interest" }),
    ).toBeVisible();
    await expect(
      landscape.getByRole("img", {
        name: "Reviews connected to claims, evidence, and graph research objects",
      }),
    ).toBeVisible();
    const details = landscape.getByRole("navigation", { name: "Knowledge landscape details" });
    await expect(details.getByRole("link").first()).toBeVisible();
    const apiResponse = await page.request.get("/api/landscape?q=replay&interest=data-code");
    expect(apiResponse.ok()).toBe(true);
    const apiLandscape = (await apiResponse.json()) as {
      schemaVersion: string;
      algorithm: { id: string; purpose: string; limitations: string[] };
      recommendations: Array<Record<string, unknown>>;
      omittedUnboundCount: number;
    };
    expect(apiLandscape.schemaVersion).toBe("2.0.0");
    expect(apiLandscape.algorithm.id).toBe("explicit-interest-recommendation");
    expect(apiLandscape.algorithm.purpose).toBe("recommendation");
    expect(apiLandscape.algorithm.limitations).toContain("not-a-truth-score");
    expect(apiLandscape.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(apiLandscape.recommendations[0]).toHaveProperty("nodeId");
    expect(apiLandscape.recommendations[0]).not.toHaveProperty("label");
    expect(apiLandscape.recommendations[0]).not.toHaveProperty("detail");
    expect(apiLandscape.recommendations[0]).not.toHaveProperty("href");
    await expect(landscape.locator('.landscape-legend [data-relation="confirmed"]')).toHaveText(
      "confirmed graph edge",
    );
    await expect(landscape.getByText("Ordering helps exploration only")).toBeVisible();
    await expect(
      landscape.getByRole("heading", { name: "When these records entered the literature" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Discuss the selected path with Atlas" }),
    ).toHaveCount(0);

    await details.getByText("Why this?", { exact: true }).first().click();
    await expect(
      details.locator(".landscape-reasons").first().getByRole("listitem").first(),
    ).toBeVisible();
    await expect(
      details.getByRole("link", { name: "Explore graph neighborhood" }).first(),
    ).toBeVisible();
    await details.getByRole("link", { name: "Mark as known" }).first().click();
    await expect(page).toHaveURL(/known=/);
    await expect(
      details.getByRole("link", { name: "Remove from known set" }).first(),
    ).toBeVisible();
    await landscape.getByRole("link", { name: "Clear known set" }).click();
    await expect(page).not.toHaveURL(/known=/);
    await details.getByRole("link", { name: "Focus on connections" }).first().click();
    await expect(page).toHaveURL(/focus=/);
    const focusedNodeId = new URL(page.url()).searchParams.get("focus");
    expect(focusedNodeId).toBeTruthy();
    expect(focusedNodeId).not.toMatch(/^(review|claim|graph):/);
    await expect(landscape.getByRole("heading", { level: 2 })).toContainText("One step from");
    await landscape.getByRole("link", { name: "Return to overview" }).click();
    await expect(page).not.toHaveURL(/focus=/);
  });

  test("specialist tools stay contextual and return to Explore", async ({ page }) => {
    await page.goto("/explore");
    await page.getByText("Specialist tools for deeper analysis", { exact: true }).click();
    const tools = page.getByRole("navigation", { name: "Specialist analysis tools" });
    await expect(tools.getByRole("link", { name: /Research objects/ })).toHaveAttribute(
      "href",
      "/nodes",
    );
    await expect(tools.getByRole("link", { name: /Evidence graph/ })).toHaveAttribute(
      "href",
      "/graph",
    );
    await expect(tools.getByRole("link", { name: /Disagreement map/ })).toHaveAttribute(
      "href",
      "/synthesis",
    );
    await expect(tools.getByRole("link", { name: /Coverage gaps/ })).toHaveAttribute(
      "href",
      "/coverage",
    );
    await expect(tools.getByRole("link", { name: /Replication briefs/ })).toHaveAttribute(
      "href",
      "/replications",
    );
    await expect(tools.getByRole("link", { name: /Scoped grounded Q&A/ })).toHaveAttribute(
      "href",
      "/explore",
    );

    await tools.getByRole("link", { name: /Coverage gaps/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Coverage gaps");
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link"),
    ).toHaveAttribute("href", "/explore");
  });

  test("unified Explore safely handles malformed public query parameters", async ({ page }) => {
    await page.goto("/explore?page=abc");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Traverse the evidence graph");
    await expect(page.getByText("Page NaN")).toHaveCount(0);

    await page.goto("/explore?view=reviews&page=abc&sort=unexpected");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Traverse the evidence graph");
    await expect(page.locator(".explore-results")).toHaveCount(0);
    await expect(page.locator("#sort")).toHaveCount(0);
  });

  test("archive filters to repository-only reviews", async ({ page }) => {
    await page.goto("/archive?hasDoi=false");
    await expect(page.getByText(/repository-only/i).first()).toBeVisible();
  });

  test("source-derived POC reviews expose limitations and remain traversable", async ({ page }) => {
    await page.goto("/reviews/vip-cortical-interneurons-critical-review");
    const recordDisclosure = page.locator("details.review-record-disclosure");
    if ((await recordDisclosure.getAttribute("open")) === null) {
      await recordDisclosure
        .locator(":scope > summary")
        .getByText("Source checks & specialist notes")
        .click();
    }

    const stressTest = page.locator("section.card").filter({
      has: page.getByRole("heading", { name: "POC scientific stress test" }),
    });
    await expect(stressTest).toContainText("Four representative synthesis claims");
    await expect(
      stressTest.getByRole("heading", { name: "Limitations to challenge" }),
    ).toBeVisible();
    await expect(stressTest).toContainText("403 of 3,816 citation triples");
    await expect(stressTest.getByRole("heading", { name: "Suggested fixes" })).toBeVisible();
    await expect(stressTest).toContainText("claim, citation, relation, and TRUST JSONL");

    await page.goto("/explore?q=disinhibition");
    const landscape = page.getByRole("region", { name: "Guided knowledge landscape" });
    await expect(landscape).toContainText(
      "Disinhibition is a reproducible component of VIP interneuron function",
    );

    await page.goto("/reviews/openscope-predictive-processing-data-release");
    await expect(page.getByText("hypothesis-capability", { exact: true })).toBeVisible();
    await expect(page.getByText(/not evidence that either alternative is true/i)).toBeVisible();
  });

  test("review page shows repository, commit, DOI distinction, claims and TRUST", async ({
    page,
  }) => {
    await page.goto("/reviews/hippocampal-replay-computational-review");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hippocampal Replay");
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Reviews" }),
    ).toHaveAttribute("href", "/archive");
    const inspectionPath = page.getByRole("navigation", { name: "Inspect this review" });
    await expect(inspectionPath.getByRole("link", { name: /Read review/ })).toHaveAttribute(
      "href",
      "#original-record",
    );
    await expect(inspectionPath.getByRole("link", { name: /Claims & evidence/ })).toHaveAttribute(
      "href",
      "#linked-evidence",
    );
    await expect(inspectionPath.getByRole("link", { name: /TRUST/ })).toHaveAttribute(
      "href",
      "#assessments",
    );
    await expect(inspectionPath.getByRole("link", { name: /Discuss & challenge/ })).toHaveAttribute(
      "href",
      "#disagreements",
    );
    expect(
      await page
        .locator(
          "#linked-evidence, #assessments, #community-review, #disagreements, #record-details",
        )
        .evaluateAll((sections) => sections.map((section) => section.id)),
    ).toEqual([
      "linked-evidence",
      "assessments",
      "community-review",
      "disagreements",
      "record-details",
    ]);
    // Version DOI and concept DOI are distinct rows (exact: these are <dt>
    // labels, and page prose such as comments may mention the same phrase).
    await expect(page.getByText("Version DOI", { exact: true })).toBeVisible();
    await expect(page.getByText("Concept DOI", { exact: true })).toBeVisible();
    // Example DOI is marked non-resolvable.
    await expect(page.getByText(/example — not resolvable/i).first()).toBeVisible();
    // A contradicting relation is present.
    await expect(page.getByText(/contradicts/i).first()).toBeVisible();
    // TRUST assessment is available.
    await expect(page.getByText(/TRUST assessment/i).first()).toBeVisible();
    await page.locator("details").evaluateAll((details) => {
      for (const detail of details) detail.open = true;
    });
    await expect(
      page
        .locator('[data-prov="human-reviewed"]:visible')
        .filter({ hasText: "Atlas structurally verified" })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .locator('[data-prov="repository-fact"]:visible')
        .filter({ hasText: "Repository/source-native — not verified by Atlas" })
        .first(),
    ).toBeVisible();
  });

  test("claim explorer finds a contradicting claim", async ({ page }) => {
    await page.goto("/claims?relationType=contradicts");
    await expect(page.getByText(/contradicting/i).first()).toBeVisible();
  });
});
