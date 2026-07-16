import "server-only";
import type { PrismaClient } from "@oratlas/db";
import {
  SynthesisWriter,
  type LlmProvider,
  type PreparedSubgraphEvidencePacket,
  type SynthesisGenerationResult,
  type SynthesisRunRecorder,
} from "@oratlas/knowledge";
import { prisma } from "./db";

/** Prisma-backed required recorder. Each transition fails closed unless the run is still running. */
export function createPrismaSynthesisRunRecorder(
  client: PrismaClient = prisma,
  generationClaim?: { key: string; leaseToken: string },
): SynthesisRunRecorder {
  return {
    async start(input) {
      return client.$transaction(async (tx) => {
        const run = await tx.agentRun.create({
          data: {
            agentType: input.agentType,
            modelProvider: input.modelProvider,
            modelName: input.modelName,
            modelVersion: input.modelVersion,
            promptVersion: input.promptVersion,
            promptHash: input.promptHash,
            packetHash: input.packetHash,
            inputHash: input.inputHash,
            inputReferencesJson: input.inputReferencesJson,
            status: "running",
          },
          select: { id: true },
        });
        if (generationClaim) {
          const bound = await tx.synthesisGenerationRequestClaim.updateMany({
            where: {
              key: generationClaim.key,
              status: "running",
              leaseToken: generationClaim.leaseToken,
              agentRunId: null,
            },
            data: { agentRunId: run.id },
          });
          if (bound.count !== 1) {
            throw new Error("Generation claim is not in an unbound running state.");
          }
        }
        return run;
      });
    },
    async succeed(id, output) {
      const updated = await client.agentRun.updateMany({
        where: { id, status: "running" },
        data: {
          status: "succeeded",
          outputJson: output.outputJson,
          completedAt: new Date(),
          error: null,
        },
      });
      if (updated.count !== 1) throw new Error("Agent run is not in a writable running state.");
    },
    async fail(id, failure) {
      const updated = await client.agentRun.updateMany({
        where: { id, status: "running" },
        data: {
          status: "failed",
          outputJson: null,
          completedAt: new Date(),
          error: `${failure.errorCode}: ${failure.error}`,
        },
      });
      if (updated.count !== 1) throw new Error("Agent run is not in a writable running state.");
    },
  };
}

export async function generateSynthesisReview(
  prepared: PreparedSubgraphEvidencePacket,
  provider?: LlmProvider,
  client: PrismaClient = prisma,
  generationClaim?: { key: string; leaseToken: string },
): Promise<SynthesisGenerationResult> {
  return new SynthesisWriter(
    createPrismaSynthesisRunRecorder(client, generationClaim),
    provider,
  ).generate(prepared);
}
