import type { PrismaClient } from "@oratlas/db";
import type { SynthesisSelector } from "@oratlas/contracts";
import type { LlmProvider, PreparedSubgraphEvidencePacket } from "@oratlas/knowledge";
import type { SessionUser } from "./auth";

export const SYNTHESIS_TOPIC_SCAN_LIMIT = 1_000;
export const SYNTHESIS_TRANSACTION_ATTEMPTS = 3;
export const SYNTHESIS_GENERATION_LEASE_MS = 5 * 60_000;

export class SynthesisEditorialError extends Error {
  constructor(
    message: string,
    readonly code: "bad-request" | "not-found" | "conflict" | "forbidden" = "bad-request",
  ) {
    super(message);
    this.name = "SynthesisEditorialError";
  }
}

export interface GenerateSynthesisDraftOptions {
  client?: PrismaClient;
  provider?: LlmProvider;
  loadPacket?: (selector: SynthesisSelector) => Promise<PreparedSubgraphEvidencePacket>;
  now?: () => Date;
  leaseDurationMs?: number;
  actor?: SessionUser;
  /** Fault-injection seam after claim creation/reclaim but before recorder.start. */
  afterRequestClaimed?: () => Promise<void>;
  /** Test/observability seam after the successful run is durably bound to the request claim. */
  afterRunClaimed?: () => Promise<void>;
}
