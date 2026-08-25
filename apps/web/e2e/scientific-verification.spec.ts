import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { SCIENTIFIC_VERIFICATION_DEMO_FINDINGS, canonicalJson } from "@oratlas/contracts";
import { getPrisma } from "@oratlas/db";
import { VerifierApiClient } from "@oratlas/verifier-client";

const publicationId = "ora-demo-publication";
const publicationVersionId = "ora-demo-publication-version";
let bearerToken = "";

test.describe("Scientific verification", () => {
  test.beforeAll(async () => {
    const prisma = getPrisma();
    const verifier = await prisma.verifier.findUniqueOrThrow({
      where: { id: "oratlas-verify-demo" },
    });
    const editor = await prisma.user.findFirstOrThrow({ where: { role: "EDITOR" } });
    const prefix = randomBytes(9).toString("base64url");
    bearerToken = `oratlas_verify_${prefix}.${randomBytes(32).toString("base64url")}`;
    await prisma.verifierCredential.create({
      data: {
        verifierId: verifier.id,
        label: "Scientific verification Playwright fixture",
        tokenPrefix: prefix,
        tokenHash: createHash("sha256").update(bearerToken).digest("hex"),
        scopesJson: canonicalJson(["verification:read", "verification:submit"]),
        issuedById: editor.id,
      },
    });
  });

  test("runs an external verification through HTTP and renders the public evidence", async ({
    page,
  }) => {
    await page.goto("/signin");
    await page.getByRole("button", { name: /Sign in as editor/ }).click();
    await expect(page).toHaveURL(/\/editorial/);
    await page.goto(`/publications/${publicationId}/versions/${publicationVersionId}`);

    await expect(page.getByText("Scientific verification", { exact: true })).toBeVisible();
    await page.getByLabel("Protocol").selectOption({ label: "Analysis result comparison · 0.1.0" });
    await page.getByRole("button", { name: "Request verification" }).click();
    await page.waitForURL(/\/verifications\/[^/]+$/);
    const runId = new URL(page.url()).pathname.split("/").at(-1);
    expect(runId).toBeTruthy();

    const client = new VerifierApiClient(
      `http://localhost:${process.env.E2E_PORT ?? "3100"}`,
      bearerToken,
    );
    await client.claim(runId!);
    const frozen = await client.getInput(runId!);
    expect(frozen).toMatchObject({
      profile: "blinded-scientific",
      profileVersion: "1.0.0",
      input: {
        schemaVersion: "verification-publication-input/1.0.0",
        sourcePacketSchemaVersion: "1.3.0",
        contributors: [],
      },
    });
    await client.transition(runId!, { status: "running" });
    await client.submitFinding(runId!, SCIENTIFIC_VERIFICATION_DEMO_FINDINGS[5]);
    await client.transition(runId!, { status: "completed" });

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Scientific verification evidence" }),
    ).toBeVisible();
    await expect(page.getByText("independently reproduced", { exact: false })).toBeVisible();
    await expect(page.getByText(/Unverifiable.*required evidence/s)).toBeVisible();
    await expect(page.getByText(/ExecutionPassport:/)).toBeVisible();

    await page.goto(`/publications/${publicationId}/versions/${publicationVersionId}`);
    await expect(
      page.locator("p").filter({ hasText: /Analyses\s+\d+ independently reproduced/ }),
    ).toBeVisible();
    await expect(page.getByText(/not a truth score or universal badge/)).toBeVisible();
  });
});
