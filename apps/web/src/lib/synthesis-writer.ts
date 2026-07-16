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
): SynthesisRunRecorder {
  return {
    async start(input) {
      const run = await client.agentRun.create({
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
      return run;
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
): Promise<SynthesisGenerationResult> {
  return new SynthesisWriter(createPrismaSynthesisRunRecorder(client), provider).generate(prepared);
}
