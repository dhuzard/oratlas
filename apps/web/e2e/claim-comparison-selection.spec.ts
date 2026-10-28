import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("archived claim selection survives refresh and opens a distinct exact pair", async ({
  page,
}) => {
  const discoveryParameters = new URLSearchParams({
    q: "memory",
    reviewSlug: "hippocampal-replay-computational-review",
    claimType: "empirical",
    focus: "focus-node-context",
  });
  discoveryParameters.append("interest", "data-code");
  discoveryParameters.append("interest", "methods-models");
  discoveryParameters.append("known", "known-node-one");
  discoveryParameters.append("known", "known-node-two");
  const discovery = `/claims?${discoveryParameters}`;
  await page.goto(discovery);

  const firstCandidate = page.getByRole("link", { name: "Select as first claim" }).first();
  await expect(firstCandidate).toBeVisible();
  const firstHref = await firstCandidate.getAttribute("href");
  expect(firstHref).toContain("q=memory");
  expect(firstHref).toContain("reviewSlug=hippocampal-replay-computational-review");
  await firstCandidate.click();

  const selection = page.getByRole("region", { name: "Claim comparison selection" });
  await expect(
    selection.getByRole("heading", { name: "Choose a second exact claim" }),
  ).toBeVisible();
  const firstReference = new URL(page.url()).searchParams.get("compareLeft");
  expect(firstReference).toMatch(/^\/claims\/[^/]+\/[^/]+$/);
  expect(new URL(page.url()).searchParams.get("q")).toBe("memory");
  expect(new URL(page.url()).searchParams.get("reviewSlug")).toBe(
    "hippocampal-replay-computational-review",
  );
  expect(new URL(page.url()).searchParams.get("claimType")).toBe("empirical");
  expect(new URL(page.url()).searchParams.get("focus")).toBe("focus-node-context");
  expect(new URL(page.url()).searchParams.getAll("interest")).toEqual([
    "data-code",
    "methods-models",
  ]);
  expect(new URL(page.url()).searchParams.getAll("known")).toEqual([
    "known-node-one",
    "known-node-two",
  ]);

  await page.reload();
  await expect(selection.getByText(firstReference!, { exact: true })).toBeVisible();
  const sameCandidate = page
    .getByText("Selected exact claim", { exact: true })
    .locator("xpath=ancestor::article[1]");
  await expect(sameCandidate).toBeVisible();
  await expect(
    sameCandidate.getByRole("link", { name: "Compare with selected claim" }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "Remove selected claim" }).click();
  expect(new URL(page.url()).searchParams.has("compareLeft")).toBe(false);
  await page.goBack();
  await expect(selection.getByText(firstReference!, { exact: true })).toBeVisible();

  const secondCandidate = page.getByRole("link", { name: "Compare with selected claim" }).first();
  await expect(secondCandidate).toBeVisible();
  const pairHref = await secondCandidate.getAttribute("href");
  expect(pairHref).toBeTruthy();
  const pairParameters = new URL(pairHref!, "http://localhost").searchParams;
  expect(pairParameters.get("left")).toBe(firstReference);
  expect(pairParameters.get("right")).toBeTruthy();
  expect(pairParameters.get("right")).not.toBe(firstReference);
  await secondCandidate.click();
  await expect(page.getByRole("heading", { name: "Compare two exact claims" })).toBeVisible();
  await expect(page.getByRole("region", { name: "First claim occurrence" })).toContainText(
    firstReference!,
  );

  const secondReference = pairParameters.get("right")!;
  const changeFirst = page.getByRole("link", { name: "Change first claim" });
  const changeFirstHref = await changeFirst.getAttribute("href");
  expect(changeFirstHref).toContain("/explore?");
  await page.goto(changeFirstHref!);
  const replaceFirst = new URL(page.url());
  expect(replaceFirst.searchParams.get("compareLeft")).toBe(secondReference);
  expect(replaceFirst.searchParams.get("replaceSide")).toBe("first");
  await page.getByRole("link", { name: "Open claim explorer" }).click();
  await expect(page.getByRole("heading", { name: "Claim explorer" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Claim comparison selection" })).toContainText(
    secondReference,
  );
  const replacementCandidate = page
    .getByRole("link", { name: "Compare with selected claim" })
    .first();
  const replacementHref = new URL(
    (await replacementCandidate.getAttribute("href"))!,
    "http://localhost",
  );
  expect(replacementHref.searchParams.get("right")).toBe(secondReference);
  expect(replacementHref.searchParams.get("left")).not.toBe(secondReference);
  await replacementCandidate.click();
  await expect(page.getByRole("heading", { name: "Compare two exact claims" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("right")).toBe(secondReference);
});

test("archived claim selection works by keyboard and opens a contained pair on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/claims?q=memory&reviewSlug=hippocampal-replay-computational-review");

  const firstCandidate = page.getByRole("link", { name: "Select as first claim" }).first();
  await expect(firstCandidate).toBeVisible();
  await firstCandidate.focus();
  await expect(firstCandidate).toBeFocused();
  await firstCandidate.press("Enter");
  const selectedParameters = new URL(page.url()).searchParams;
  expect(selectedParameters.get("q")).toBe("memory");
  expect(selectedParameters.get("reviewSlug")).toBe("hippocampal-replay-computational-review");

  const compareCandidate = page.getByRole("link", { name: "Compare with selected claim" }).first();
  await expect(compareCandidate).toBeVisible();
  await compareCandidate.focus();
  await expect(compareCandidate).toBeFocused();
  const candidateHref = await compareCandidate.getAttribute("href");
  const candidatePair = new URL(candidateHref!, "http://localhost").searchParams;
  expect(candidatePair.get("left")).toBe(selectedParameters.get("compareLeft"));
  expect(candidatePair.get("right")).not.toBe(selectedParameters.get("compareLeft"));
  await compareCandidate.press("Enter");
  await expect(page.getByRole("heading", { name: "Compare two exact claims" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const axe = await new AxeBuilder({ page }).include(".claim-pair-page").analyze();
  expect(
    axe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")),
  ).toEqual([]);
});

test("clipboard denial leaves exact references selectable for manual copy", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => Promise.reject(new Error("clipboard denied")) },
    });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Compare two claims · synthetic example" }).click();
  await expect(page.getByRole("heading", { name: "Compare two exact claims" })).toBeVisible();
  await page.getByRole("button", { name: "Copy exact references", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Copy was unavailable. Select and copy the references below.",
  );
  const references = page.getByLabel("Select and copy exact references");
  await expect(references).toBeVisible();
  await expect(references).toHaveAttribute("readonly", "");
  await expect(references).toHaveValue(/"left": \{/);
  await references.focus();
  const selectedRange = await references.evaluate((element: HTMLTextAreaElement) => [
    element.selectionStart,
    element.selectionEnd,
    element.value.length,
  ]);
  expect(selectedRange[0]).toBe(0);
  expect(selectedRange[1]).toBe(selectedRange[2]);

  const browser = context.browser();
  expect(browser).toBeTruthy();
  const secondContext = await browser!.newContext();
  try {
    const secondBrowser = await secondContext.newPage();
    await secondBrowser.goto(page.url());
    await expect(
      secondBrowser.getByRole("heading", { name: "Compare two exact claims" }),
    ).toBeVisible();
    await expect(
      secondBrowser.getByRole("region", { name: "First claim occurrence" }),
    ).toContainText(new URL(page.url()).searchParams.get("left")!);
  } finally {
    await secondContext.close();
  }
});
