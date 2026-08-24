import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { getPrisma } from "@oratlas/db";
import {
  ORA_CERTIFIER_SLUG,
  ORA_SCIENTIFIC_MERIT_PROMPT_VERSION,
  ORA_SCIENTIFIC_MERIT_SERIES,
  ORA_SCIENTIFIC_MERIT_VERSION,
  canonicalJson,
} from "@oratlas/contracts";
import { ORA_SCIENTIFIC_MERIT_SYSTEM_PROMPT } from "@oratlas/knowledge";
import {
  CertifierApiClient,
  OraCertificationService,
  type OraExecutionRecorder,
} from "@oratlas/ora-certifier";
import { createDeterministicOraTestEvaluator } from "@oratlas/ora-certifier/testing";

const publicationId = "ora-demo-publication";
const publicationVersionId = "ora-demo-publication-version";
let bearerToken = "";

test.describe("ORA scientific merit pilot", () => {
  test.beforeAll(async () => {
    const prisma = getPrisma();
    const certifier = await prisma.certifier.findUniqueOrThrow({
      where: { slug: ORA_CERTIFIER_SLUG },
    });
    const protocol = await prisma.certificationProtocol.findUniqueOrThrow({
      where: {
        certifierId_seriesKey_protocolVersion: {
          certifierId: certifier.id,
          seriesKey: ORA_SCIENTIFIC_MERIT_SERIES,
          protocolVersion: ORA_SCIENTIFIC_MERIT_VERSION,
        },
      },
    });
    const editor = await prisma.user.findFirstOrThrow({ where: { role: "EDITOR" } });
    const prefix = randomBytes(9).toString("base64url").slice(0, 12);
    bearerToken = `oratlas_cert_${prefix}.ora-e2e-synthetic-secret`;
    await prisma.certifierCredential.create({
      data: {
        certifierId: certifier.id,
        label: "ORA Playwright synthetic fixture",
        tokenPrefix: prefix,
        tokenHash: sha256(bearerToken),
        scopesJson: canonicalJson(["certification:read", "certification:submit"]),
        issuedById: editor.id,
      },
    });

    const existing = await prisma.certificationResult.findFirst({
      where: { publicationVersionId, protocolId: protocol.id },
    });
    if (existing) return;

    const recorder: OraExecutionRecorder = {
      async recordSucceeded(input) {
        const outputJson = canonicalJson({
          criteria: input.evaluation.criteria,
          limitations: input.evaluation.limitations,
        });
        const row = await prisma.agentRun.create({
          data: {
            agentType: "external-certification",
            modelProvider: input.metadata.provider,
            modelName: input.metadata.model,
            modelVersion: input.metadata.modelVersion,
            promptVersion: ORA_SCIENTIFIC_MERIT_PROMPT_VERSION,
            promptHash: sha256(ORA_SCIENTIFIC_MERIT_SYSTEM_PROMPT),
            packetHash: input.packetSha256,
            inputHash: input.packetSha256,
            inputReferencesJson: canonicalJson({ packetSha256: input.packetSha256 }),
            outputJson,
            status: "succeeded",
            startedAt: new Date(input.metadata.startedAt),
            completedAt: new Date(input.metadata.completedAt),
          },
        });
        return { agentRunId: row.id, structuredOutputSha256: sha256(outputJson) };
      },
    };
    const baseUrl = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
    await new OraCertificationService(
      new CertifierApiClient(baseUrl, bearerToken),
      createDeterministicOraTestEvaluator("strong"),
      recorder,
    ).certify({
      publicationVersionId,
      certificationProtocolId: protocol.id,
      idempotencyKey: `ora:e2e:${publicationVersionId}:${ORA_SCIENTIFIC_MERIT_VERSION}`,
      externalRunReference: "playwright:synthetic-demo",
    });
  });

  test("certifies the labeled synthetic fixture through the public API and renders provenance", async ({
    page,
  }) => {
    await page.goto(`/publications/${publicationId}/versions/${publicationVersionId}`);
    await expect(page.getByText("Demo / synthetic", { exact: true })).toBeVisible();
    const resultLink = page.getByRole("link", { name: "ORA Certified · Pilot" });
    await expect(resultLink).toBeVisible();
    await resultLink.click();

    await expect(page.getByRole("heading", { name: "ORA Scientific Merit Pilot" })).toBeVisible();
    await expect(
      page.getByText("C1 — Publication identity and provenance integrity"),
    ).toBeVisible();
    await expect(page.getByText("1.2.0", { exact: true })).toBeVisible();
    await expect(page.getByText("complete", { exact: true })).toBeVisible();
    await expect(page.getByText("not-provided", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/independently of the publication's declared production workflow/),
    ).toBeVisible();
    await expect(
      page.locator("dt", { hasText: "AgentRun" }).locator("xpath=following-sibling::dd[1]"),
    ).toHaveText(/^c[a-z0-9]+$/);
  });

  test("does not grant certifier credentials editorial or graph mutation access", async ({
    request,
  }) => {
    const headers = {
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
      origin: `http://localhost:${process.env.E2E_PORT ?? "3100"}`,
    };
    const editorial = await request.post("/api/editorial/ora-certifications", {
      headers,
      data: { publicationVersionId },
    });
    const graph = await request.post("/api/editorial/graph-curation", {
      headers,
      data: {},
    });
    expect(editorial.status()).toBe(401);
    expect(graph.status()).toBe(401);
  });
});

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
