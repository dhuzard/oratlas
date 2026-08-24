import { createHash } from "node:crypto";
import { canonicalJson } from "@oratlas/contracts";
import { getPrisma } from "@oratlas/db";
import { ORA_SCIENTIFIC_MERIT_SYSTEM_PROMPT } from "@oratlas/knowledge";
import type { OraExecutionRecorder } from "@oratlas/ora-certifier";
import { CertifierApiClient, OraCertificationService } from "@oratlas/ora-certifier";
import { createDeterministicOraTestEvaluator } from "@oratlas/ora-certifier/testing";
import { assertSafeOraDemoBaseUrl } from "./ora-demo-target";

if (process.env.NODE_ENV === "production")
  throw new Error("The deterministic ORA demo evaluator is forbidden in production.");
const baseUrl = assertSafeOraDemoBaseUrl(
  process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000",
  process.env.ORA_DEMO_ALLOW_REMOTE === "1",
);
const token = process.env.ORA_CERTIFIER_API_TOKEN;
if (!token)
  throw new Error("ORA_CERTIFIER_API_TOKEN is required. Issue an ephemeral ORA credential first.");

const prisma = getPrisma();
const recorder: OraExecutionRecorder = {
  async recordSucceeded(input) {
    const outputJson = canonicalJson({
      criteria: input.evaluation.criteria,
      limitations: input.evaluation.limitations,
    });
    const outputHash = sha256(outputJson);
    const row = await prisma.agentRun.create({
      data: {
        agentType: "external-certification",
        modelProvider: input.metadata.provider,
        modelName: input.metadata.model,
        modelVersion: input.metadata.modelVersion,
        promptVersion: input.metadata.promptVersion,
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
    return { agentRunId: row.id, structuredOutputSha256: outputHash };
  },
};

try {
  const result = await new OraCertificationService(
    new CertifierApiClient(baseUrl, token),
    createDeterministicOraTestEvaluator("strong"),
    recorder,
  ).certify({
    publicationVersionId: "ora-demo-publication-version",
    certificationProtocolId: "ora-scientific-merit-pilot-0-1-0",
    idempotencyKey: "ora:demo:scientific-merit-pilot:0.1.0:v1",
    externalRunReference: "demo-synthetic-only",
  });
  process.stdout.write(`${JSON.stringify(result.result, null, 2)}\n`);
} finally {
  await prisma.$disconnect();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
