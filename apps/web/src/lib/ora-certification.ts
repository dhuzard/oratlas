import "server-only";
import { createHash } from "node:crypto";
import { getServerEnv } from "@oratlas/config";
import {
  ORA_CERTIFIER_SLUG,
  ORA_SCIENTIFIC_MERIT_SERIES,
  ORA_SCIENTIFIC_MERIT_VERSION,
  canonicalJson,
} from "@oratlas/contracts";
import {
  OraScientificMeritEvaluator,
  ORA_SCIENTIFIC_MERIT_SYSTEM_PROMPT,
  createAnthropicProvider,
  createOpenAIProvider,
  type LlmProvider,
} from "@oratlas/knowledge";
import {
  CertifierApiClient,
  OraCertificationService,
  type OraExecutionRecorder,
} from "@oratlas/ora-certifier";
import { prisma } from "./db";

export class OraCertificationUnavailableError extends Error {
  constructor(message = "Real ORA certification is not configured on this server.") {
    super(message);
    this.name = "OraCertificationUnavailableError";
  }
}

export async function getOraCertificationReadiness(publicationVersionId: string) {
  const env = getServerEnv();
  const [version, protocol] = await Promise.all([
    prisma.publicationVersion.findUnique({
      where: { id: publicationVersionId },
      select: {
        id: true,
        title: true,
        contentCompletenessJson: true,
        contentCorpusSha256: true,
      },
    }),
    prisma.certificationProtocol.findFirst({
      where: {
        certifier: { slug: ORA_CERTIFIER_SLUG },
        seriesKey: ORA_SCIENTIFIC_MERIT_SERIES,
        protocolVersion: ORA_SCIENTIFIC_MERIT_VERSION,
        status: "active",
      },
    }),
  ]);
  if (!version) throw new Error("PublicationVersion not found.");
  return {
    available: env.oraCertificationEnabled && Boolean(protocol),
    publicationVersion: {
      id: version.id,
      title: version.title,
      contentCompleteness: JSON.parse(version.contentCompletenessJson),
      contentCorpusSha256: version.contentCorpusSha256,
    },
    protocol: protocol
      ? {
          id: protocol.id,
          series: protocol.seriesKey,
          version: protocol.protocolVersion,
          title: protocol.title,
        }
      : null,
    assessmentMode: "ai" as const,
  };
}

export async function initiateOraCertification(publicationVersionId: string) {
  const env = getServerEnv();
  if (!env.oraCertificationEnabled || !env.ORA_CERTIFIER_API_TOKEN)
    throw new OraCertificationUnavailableError();
  const readiness = await getOraCertificationReadiness(publicationVersionId);
  if (!readiness.protocol)
    throw new OraCertificationUnavailableError("ORA Pilot 0.1.0 is not active.");

  const idempotencyKey = `ora:${readiness.protocol.id}:${publicationVersionId}`;
  const existing = await prisma.certificationRun.findUnique({
    where: {
      certifierId_idempotencyKey: {
        certifierId: (
          await prisma.certifier.findUniqueOrThrow({ where: { slug: ORA_CERTIFIER_SLUG } })
        ).id,
        idempotencyKey,
      },
    },
    include: { result: true },
  });
  if (existing?.result)
    return { replayed: true, resultId: existing.result.id, outcome: existing.result.outcome };
  if (existing && existing.status !== "running")
    throw new Error(
      `Existing ORA certification run is ${existing.status}; use a new deliberate run key to retry.`,
    );

  const provider = configuredOraProvider(env);
  const service = new OraCertificationService(
    new CertifierApiClient(env.NEXT_PUBLIC_BASE_URL, env.ORA_CERTIFIER_API_TOKEN),
    new OraScientificMeritEvaluator(provider),
    new DatabaseOraExecutionRecorder(),
  );
  const completed = await service.certify({
    publicationVersionId,
    certificationProtocolId: readiness.protocol.id,
    idempotencyKey,
    externalRunReference: `editorial:${publicationVersionId}:${ORA_SCIENTIFIC_MERIT_VERSION}`,
  });
  const result = completed.result as { id: string; outcome: string };
  return { replayed: false, resultId: result.id, outcome: result.outcome };
}

class DatabaseOraExecutionRecorder implements OraExecutionRecorder {
  async recordSucceeded(input: Parameters<OraExecutionRecorder["recordSucceeded"]>[0]) {
    const outputJson = canonicalJson({
      criteria: input.evaluation.criteria,
      limitations: input.evaluation.limitations,
    });
    const structuredOutputSha256 = sha256(outputJson);
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
        inputReferencesJson: canonicalJson({
          packetSha256: input.packetSha256,
          promptVersion: input.metadata.promptVersion,
        }),
        outputJson,
        status: "succeeded",
        startedAt: new Date(input.metadata.startedAt),
        completedAt: new Date(input.metadata.completedAt),
      },
    });
    return { agentRunId: row.id, structuredOutputSha256 };
  }
}

function configuredOraProvider(env: ReturnType<typeof getServerEnv>): LlmProvider {
  if (!env.ORA_EVALUATOR_PROVIDER || !env.ORA_EVALUATOR_MODEL)
    throw new OraCertificationUnavailableError();
  if (env.ORA_EVALUATOR_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY)
    return createAnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ORA_EVALUATOR_MODEL,
    });
  if (env.ORA_EVALUATOR_PROVIDER === "openai" && env.OPENAI_API_KEY)
    return createOpenAIProvider({ apiKey: env.OPENAI_API_KEY, model: env.ORA_EVALUATOR_MODEL });
  throw new OraCertificationUnavailableError();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
