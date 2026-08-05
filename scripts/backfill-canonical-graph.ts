import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "@oratlas/contracts";
import { assertProductionBackupId, getPrisma, type Prisma } from "@oratlas/db";
import {
  materializeCanonicalReviewGraph,
  type CanonicalGraphMaterializationReport,
} from "../apps/web/src/lib/canonical-graph-materialization.js";
import {
  canonicalValidationTotal,
  countMissingReviewAssertions,
} from "./canonical-graph-backfill-validation.js";

interface Options {
  apply: boolean;
  all: boolean;
  after?: string;
  batchSize: number;
  finalizeContract: boolean;
  manifest?: string;
}

interface VersionValidation {
  reviewVersionId: string;
  missingReviewBinding: number;
  missingReviewVersionBinding: number;
  missingClaimBindings: number;
  missingReviewAssertionBindings: number;
  missingCitationBindings: number;
  missingRelationBindings: number;
  semanticMismatchCount: number;
}

interface ManifestEntry {
  reviewVersionId: string;
  status: "validated" | "materialized" | "failed";
  validation: VersionValidation;
  materialization?: CanonicalGraphMaterializationReport;
  protectedLedgerDigest?: string;
  error?: string;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const prisma = getPrisma();
  const startedAt = new Date();
  const entries: ManifestEntry[] = [];
  let failed = false;
  let cursor = options.after;

  try {
    let selectedCount = 0;
    let selectAnotherBatch = true;
    while (selectAnotherBatch) {
      const versions = await prisma.reviewVersion.findMany({
        where: cursor ? { id: { gt: cursor } } : undefined,
        select: { id: true },
        orderBy: { id: "asc" },
        take: options.batchSize,
      });
      selectedCount += versions.length;
      for (const { id } of versions) {
        if (!options.apply) {
          const validation = await validateVersion(prisma, id);
          const errors = validationTotal(validation);
          entries.push({
            reviewVersionId: id,
            status: errors === 0 ? "validated" : "failed",
            validation,
            ...(errors === 0
              ? {}
              : { error: `Validation found ${errors} canonical graph error(s).` }),
          });
          if (errors !== 0) {
            failed = true;
            break;
          }
        } else {
          try {
            const result = await prisma.$transaction(
              async (tx) => {
                const before = await protectedLedgerDigest(tx, id);
                const materialization = await materializeCanonicalReviewGraph(tx, id);
                const after = await protectedLedgerDigest(tx, id);
                if (before !== after) {
                  throw new Error(`Protected ledger digest changed for review version '${id}'.`);
                }
                const validation = await validateVersion(tx, id);
                if (validationTotal(validation) !== 0) {
                  throw new Error(
                    `Canonical graph validation retained ${validationTotal(validation)} error(s).`,
                  );
                }
                return { materialization, validation, protectedLedgerDigest: after };
              },
              { isolationLevel: "Serializable", timeout: 30_000 },
            );
            entries.push({ reviewVersionId: id, status: "materialized", ...result });
          } catch (error) {
            entries.push({
              reviewVersionId: id,
              status: "failed",
              validation: await validateVersion(prisma, id),
              error: error instanceof Error ? error.message : "Unknown backfill failure.",
            });
            failed = true;
            break;
          }
        }
        cursor = id;
      }
      selectAnotherBatch = !failed && options.all && versions.length === options.batchSize;
    }

    const lastSuccess = [...entries]
      .reverse()
      .find((entry) => entry.status !== "failed")?.reviewVersionId;
    const remaining = lastSuccess
      ? await prisma.reviewVersion.count({ where: { id: { gt: lastSuccess } } })
      : await prisma.reviewVersion.count({ where: cursor ? { id: { gt: cursor } } : {} });
    const corpusComplete = !failed && remaining === 0;
    const backupId = options.finalizeContract
      ? assertProductionBackupId(process.env.ORATLAS_SCHEMA_BACKUP_ID)
      : undefined;
    const contractManifestDigest = options.finalizeContract
      ? createHash("sha256")
          .update(
            canonicalJson({
              schemaVersion: "canonical-graph-backfill@1.1.0",
              backupId,
              entries,
              requestedAfter: options.after ?? null,
            }),
          )
          .digest("hex")
      : undefined;
    let contractEnforced = false;
    let contractActivatedNow = false;
    let activationBackupId: string | null = null;
    let activationManifestDigest: string | null = null;
    let contractError: string | undefined;
    if (options.finalizeContract) {
      if (!corpusComplete) {
        contractError = "Canonical graph contract requires a complete, zero-error backfill.";
        failed = true;
      } else {
        try {
          const activation = await prisma.$queryRaw<
            Array<{ activated: boolean }>
          >`SELECT "oratlas_finalize_canonical_graph_contract"(${backupId}, ${contractManifestDigest}) AS activated`;
          contractActivatedNow = activation[0]?.activated === true;
          const state = await prisma.$queryRaw<
            Array<{ enforced: boolean; backupId: string | null; manifestDigest: string | null }>
          >`SELECT "enforced", "backupId", "manifestDigest" FROM "CanonicalGraphContractState" WHERE "id" = 1`;
          contractEnforced = state[0]?.enforced === true;
          activationBackupId = state[0]?.backupId ?? null;
          activationManifestDigest = state[0]?.manifestDigest ?? null;
          if (!contractEnforced)
            throw new Error("Contract activation did not persist enforcement.");
        } catch (error) {
          contractError = error instanceof Error ? error.message : "Contract activation failed.";
          failed = true;
        }
      }
    }
    const manifest = {
      schemaVersion: "canonical-graph-backfill@1.1.0",
      mode: options.apply ? "apply" : "validate",
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      requestedAfter: options.after ?? null,
      nextAfter: failed ? (lastSuccess ?? options.after ?? null) : (lastSuccess ?? null),
      batchSize: options.batchSize,
      selectedCount,
      processedCount: entries.filter(({ status }) => status !== "failed").length,
      failed,
      remainingAfterCursor: remaining,
      complete: !failed && corpusComplete && (!options.finalizeContract || contractEnforced),
      contract: {
        requested: options.finalizeContract,
        enforced: contractEnforced,
        activatedNow: contractActivatedNow,
        requestedBackupId: backupId ?? null,
        requestedManifestDigest: contractManifestDigest ?? null,
        activationBackupId,
        activationManifestDigest,
        error: contractError ?? null,
      },
      entries,
    };
    const output = `${JSON.stringify(manifest, null, 2)}\n`;
    if (options.manifest) writeFileSync(resolve(options.manifest), output, "utf8");
    process.stdout.write(output);
    if (failed) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Unknown backfill failure."}\n`);
  process.exitCode = 1;
});

function parseOptions(args: string[]): Options {
  const options: Options = { apply: false, all: false, batchSize: 100, finalizeContract: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--apply") options.apply = true;
    else if (arg === "--all") options.all = true;
    else if (arg === "--finalize-contract") options.finalizeContract = true;
    else if (arg === "--after") options.after = requiredValue(args, ++index, arg);
    else if (arg === "--manifest") options.manifest = requiredValue(args, ++index, arg);
    else if (arg === "--batch-size") {
      const value = Number(requiredValue(args, ++index, arg));
      if (!Number.isInteger(value) || value < 1 || value > 500) {
        throw new Error("--batch-size must be an integer from 1 to 500.");
      }
      options.batchSize = value;
    } else {
      throw new Error(`Unknown argument '${arg}'.`);
    }
  }
  if (options.apply && !options.manifest) {
    throw new Error("--apply requires --manifest so the resumable change record is retained.");
  }
  if (options.finalizeContract && (!options.apply || !options.all || !options.manifest)) {
    throw new Error("--finalize-contract requires --apply, --all, and --manifest.");
  }
  if ((options.apply || options.finalizeContract) && process.env.NODE_ENV === "production") {
    try {
      assertProductionBackupId(process.env.ORATLAS_SCHEMA_BACKUP_ID);
    } catch {
      throw new Error(
        "Production backfill requires ORATLAS_SCHEMA_BACKUP_ID from the verified backup gate.",
      );
    }
  }
  return options;
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

type GraphClient = Pick<
  Prisma.TransactionClient,
  | "reviewVersion"
  | "nodeEdge"
  | "claimEvidenceRelation"
  | "trustAssessment"
  | "trustVerification"
  | "challenge"
  | "challengeTransition"
  | "challengeResponse"
  | "trustAdjudication"
  | "trustAdjudicationReference"
>;

async function validateVersion(
  client: GraphClient,
  reviewVersionId: string,
): Promise<VersionValidation> {
  const version = await client.reviewVersion.findUnique({
    where: { id: reviewVersionId },
    include: {
      review: { include: { knowledgeNode: true } },
      graphVersion: true,
      claims: { include: { knowledgeNode: true, graphVersion: true } },
      citations: { include: { knowledgeNode: true, graphVersion: true } },
    },
  });
  if (!version) throw new Error(`Review version '${reviewVersionId}' disappeared.`);
  const relations = await client.claimEvidenceRelation.findMany({
    where: { claim: { reviewVersionId } },
    include: {
      nodeEdge: true,
      claim: { include: { graphVersion: true } },
      citation: { include: { graphVersion: true } },
    },
  });
  const reviewAssertions = version.graphVersion
    ? await client.nodeEdge.findMany({
        where: {
          sourceNodeVersionId: version.graphVersion.id,
          relationType: "asserts",
          status: "source-assertion",
          provenance: "imported-from-review",
        },
      })
    : [];
  const missingReviewBinding = version.review.knowledgeNode ? 0 : 1;
  const missingReviewVersionBinding = version.graphVersion ? 0 : 1;
  const missingClaimBindings = version.claims.filter(
    ({ knowledgeNode, graphVersion }) => !knowledgeNode || !graphVersion,
  ).length;
  const missingCitationBindings = version.citations.filter(
    ({ workId, knowledgeNode, graphVersion }) => !workId || !knowledgeNode || !graphVersion,
  ).length;
  const missingReviewAssertionBindings = countMissingReviewAssertions(
    version.claims,
    reviewAssertions,
  );
  const missingRelationBindings = relations.filter(({ nodeEdge }) => !nodeEdge).length;
  const semanticMismatchCount = relations.filter(
    ({ nodeEdge, claim, citation, id, relationType }) =>
      nodeEdge
        ? nodeEdge.edgeDiscriminator !== id ||
          nodeEdge.relationType !== relationType ||
          nodeEdge.status !== "source-assertion" ||
          nodeEdge.provenance !== "imported-from-review" ||
          nodeEdge.sourceNodeVersionId !== claim.graphVersion?.id ||
          nodeEdge.targetNodeId !== citation.knowledgeNodeId ||
          nodeEdge.confirmedTargetNodeVersionId !== citation.graphVersion?.id ||
          nodeEdge.confirmedById !== null
        : false,
  ).length;
  return {
    reviewVersionId,
    missingReviewBinding,
    missingReviewVersionBinding,
    missingClaimBindings,
    missingReviewAssertionBindings,
    missingCitationBindings,
    missingRelationBindings,
    semanticMismatchCount,
  };
}

function validationTotal(validation: VersionValidation): number {
  return canonicalValidationTotal(validation);
}

async function protectedLedgerDigest(
  tx: Prisma.TransactionClient,
  reviewVersionId: string,
): Promise<string> {
  const relationIds = (
    await tx.claimEvidenceRelation.findMany({
      where: { claim: { reviewVersionId } },
      select: { id: true },
      orderBy: { id: "asc" },
    })
  ).map(({ id }) => id);
  const adjudications = await tx.trustAdjudication.findMany({
    where: { claimEvidenceRelationId: { in: relationIds } },
    orderBy: { id: "asc" },
  });
  const adjudicationIds = adjudications.map(({ id }) => id);
  const snapshot = {
    assessments: await tx.trustAssessment.findMany({
      where: { claimEvidenceRelationId: { in: relationIds } },
      orderBy: { id: "asc" },
    }),
    verifications: await tx.trustVerification.findMany({
      where: { assessment: { claimEvidenceRelationId: { in: relationIds } } },
      orderBy: { id: "asc" },
    }),
    challenges: await tx.challenge.findMany({
      where: { reviewVersionId },
      orderBy: { id: "asc" },
    }),
    transitions: await tx.challengeTransition.findMany({
      where: { challenge: { reviewVersionId } },
      orderBy: [{ challengeId: "asc" }, { revision: "asc" }],
    }),
    responses: await tx.challengeResponse.findMany({
      where: { challenge: { reviewVersionId } },
      orderBy: { id: "asc" },
    }),
    adjudications,
    adjudicationReferences: await tx.trustAdjudicationReference.findMany({
      where: { adjudicationId: { in: adjudicationIds } },
      orderBy: [{ adjudicationId: "asc" }, { position: "asc" }],
    }),
  };
  return createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}
