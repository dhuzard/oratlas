import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@oratlas/db";
import {
  canonicalJson,
  editorialSynthesisDraftSchema,
  isSupportedSynthesisAcceptanceChecklist,
  liveSynthesisDoiPairSchema,
  publicSynthesisReviewSchema,
  subgraphEvidenceTrustSchema,
  subgraphEvidencePacketSchema,
  synthesisDraftDecisionSchema,
  synthesisGenerationRequestSchema,
  synthesisSelectorSchema,
  TRUST_CRITERIA,
  SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
  SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
  SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
  SYNTHESIS_PIPELINE_SOFTWARE_ID,
  SYNTHESIS_PIPELINE_SOFTWARE_NAME,
  SYNTHESIS_STALENESS_POLICY_VERSION,
  type EditorialSynthesisDraft,
  type PublicSynthesisReview,
  type SubgraphEvidenceSource,
  type SynthesisDraftDecision,
  type SynthesisGenerationRequest,
  type SynthesisReviewCitation,
  type SynthesisReviewDocument,
  type SynthesisSelector,
} from "@oratlas/contracts";
import {
  assertCanonicalPreparedPacket,
  buildPreparedSubgraphEvidencePacket,
  canonicalizeEvidenceTopic,
  fingerprintSubgraphEvidenceSelection,
  SYNTHESIS_PIPELINE_VERSION,
  synthesisGenerationKey,
  synthesisSelectionIdentity,
  verifySynthesisDocument,
  type LlmProvider,
  type PreparedSubgraphEvidencePacket,
  type SynthesisGenerationResult,
} from "@oratlas/knowledge";
import { validateStoredSynthesisStaleness } from "./synthesis-staleness-integrity";
import type { SessionUser } from "./auth";
import { prisma } from "./db";
import { publicConfirmedNodeEdgeWhere } from "./node-edge-publication";
import { tryMapPublicNodeVersion } from "./node-publication";
import { generateSynthesisReview } from "./synthesis-writer";
import {
  loadedNodeRelationTrustInclude,
  PUBLIC_NODE_RELATION_TRUST_GLOBAL_LIMIT,
  PUBLIC_NODE_RELATION_TRUST_PER_KEY_LIMIT,
  resolveLoadedNodeRelationTrustAssessment,
} from "./trust-provenance";
import { orderTrustAssessments } from "@oratlas/trust";

const SYNTHESIS_TOPIC_SCAN_LIMIT = 1_000;
const SYNTHESIS_TRANSACTION_ATTEMPTS = 3;
const SYNTHESIS_GENERATION_LEASE_MS = 5 * 60_000;

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

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function synthesisSeriesKey(selector: SynthesisSelector): string {
  return digest(canonicalJson(selector.selection));
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type CurrentNodeRow = Awaited<ReturnType<typeof loadCurrentNodeRows>>[number];

async function loadCurrentNodeRows(client: PrismaClient, ids?: string[]) {
  return client.knowledgeNode.findMany({
    where: ids ? { id: { in: ids } } : undefined,
    orderBy: { id: "asc" },
    ...(ids ? {} : { take: SYNTHESIS_TOPIC_SCAN_LIMIT + 1 }),
    include: {
      repository: { select: { owner: true, name: true, canonicalUrl: true } },
      versions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        include: { snapshot: { select: { commitSha: true } } },
      },
    },
  });
}

function mapEvidenceNode(row: CurrentNodeRow) {
  const version = row.versions[0];
  if (!version) return undefined;
  const mapped = tryMapPublicNodeVersion(row, version);
  if (!mapped) return undefined;
  return {
    id: row.id,
    localNodeId: row.localNodeId,
    repository: {
      owner: row.repository.owner,
      name: row.repository.name,
      url: row.repository.canonicalUrl,
    },
    versionId: mapped.id,
    snapshotId: mapped.snapshotId,
    commitSha: mapped.commitSha,
    title: mapped.title,
    abstract: mapped.abstract,
    text: mapped.text,
    contributors: mapped.contributors,
    license: mapped.license,
    provenance: mapped.provenance,
    identifiers: mapped.identifiers,
    isExample: mapped.isExample,
    createdAt: mapped.createdAt,
    kind: mapped.kind,
    payload: mapped.payload,
  } as SubgraphEvidenceSource["nodes"][number];
}

function topicMatches(row: ReturnType<typeof mapEvidenceNode>, query: string): boolean {
  if (!row) return false;
  const haystack = canonicalizeEvidenceTopic(`${row.title} ${row.abstract ?? ""}`);
  return query.split(" ").every((token) => haystack.includes(token));
}

async function loadAuthoritativeTrustByEdge(
  client: PrismaClient,
  selectedEdges: SubgraphEvidenceSource["edges"],
) {
  const result = new Map<
    string,
    NonNullable<SubgraphEvidenceSource["edges"][number]["trustAssessments"]>
  >();
  if (selectedEdges.length === 0) return result;
  const rows = await client.nodeRelationTrustAssessment.findMany({
    where: {
      proposal: {
        confirmedEdgeId: { in: selectedEdges.map((edge) => edge.id) },
        status: "confirmed",
      },
    },
    include: loadedNodeRelationTrustInclude,
    orderBy: [{ assessedAt: "desc" }, { id: "asc" }],
    take: PUBLIC_NODE_RELATION_TRUST_GLOBAL_LIMIT + 1,
  });
  if (rows.length > PUBLIC_NODE_RELATION_TRUST_GLOBAL_LIMIT) {
    throw new SynthesisEditorialError("TRUST selection exceeds the authoritative global bound.");
  }
  const byEdge = new Map<string, typeof rows>();
  for (const row of rows) {
    const edgeId = row.proposal.confirmedEdgeId;
    if (!edgeId) continue;
    const values = byEdge.get(edgeId) ?? [];
    values.push(row);
    byEdge.set(edgeId, values);
  }
  for (const edge of selectedEdges) {
    const candidates = byEdge.get(edge.id) ?? [];
    if (candidates.length > PUBLIC_NODE_RELATION_TRUST_PER_KEY_LIMIT) {
      throw new SynthesisEditorialError(
        "TRUST selection exceeds the authoritative per-relation bound.",
      );
    }
    const assessments = orderTrustAssessments(
      candidates.flatMap((row) => {
        try {
          const resolved = resolveLoadedNodeRelationTrustAssessment(row);
          if (!resolved.authoritative) return [];
          const criteria = TRUST_CRITERIA.flatMap((criterion) => {
            const encoded = resolved.subject.assessment.criteriaJson[criterion];
            if (!encoded) return [];
            const parsed = JSON.parse(encoded) as unknown;
            if (typeof parsed !== "object" || parsed === null) return [];
            const record = parsed as Record<string, unknown>;
            const inferredStatus =
              record.rating === "not-assessed"
                ? "not-assessed"
                : record.rating === "not-applicable"
                  ? "not-applicable"
                  : "assessed";
            return [{ criterion, ...record, status: record.status ?? inferredStatus }];
          });
          const limitationsValue = JSON.parse(
            resolved.subject.assessment.limitationsJson,
          ) as unknown;
          const value = subgraphEvidenceTrustSchema.safeParse({
            subject: {
              sourceNodeId: edge.sourceNodeId,
              sourceVersionId: edge.sourceVersionId,
              targetNodeId: edge.targetNodeId,
              targetVersionId: edge.targetVersionId,
              relationType: edge.relationType,
            },
            assessmentId: row.id,
            protocolVersion: row.protocolVersion,
            reviewStatus: resolved.effectiveStatus,
            verificationState: resolved.state,
            criteria,
            limitations: Array.isArray(limitationsValue) ? limitationsValue : undefined,
            aggregateScore: row.aggregateScore ?? undefined,
            aggregateMethod: row.aggregateMethod ?? undefined,
          });
          if (!value.success) return [];
          return [
            {
              id: row.id,
              assessedAt: row.assessedAt?.toISOString() ?? null,
              assessorType: row.assessorType,
              assessorId: row.assessorId,
              protocolVersion: row.protocolVersion,
              value: value.data,
            },
          ];
        } catch {
          return [];
        }
      }),
    ).map(({ value }) => value);
    result.set(edge.id, assessments);
  }
  return result;
}

/**
 * Production KG-11 loader. It uses only newest valid node versions, exact
 * editor-confirmed edges, explicit relation/depth bounds and complete
 * contradiction coverage within the selected bounded domain.
 */
export async function loadPreparedSynthesisPacket(
  selectorInput: SynthesisSelector,
  client: PrismaClient = prisma,
): Promise<PreparedSubgraphEvidencePacket> {
  const selector = synthesisSelectorSchema.parse(selectorInput);
  const seriesSelection = selector.selection;
  const initialRows =
    seriesSelection.kind === "seed"
      ? await loadCurrentNodeRows(client, [seriesSelection.nodeId])
      : await loadCurrentNodeRows(client);
  if (initialRows.length > SYNTHESIS_TOPIC_SCAN_LIMIT) {
    throw new SynthesisEditorialError("Topic selection exceeds the bounded current-node scan.");
  }
  const mappedInitial = initialRows.flatMap((row) => {
    const mapped = mapEvidenceNode(row);
    return mapped ? [mapped] : [];
  });
  let seeds =
    seriesSelection.kind === "seed"
      ? mappedInitial.filter((node) => node.id === seriesSelection.nodeId)
      : mappedInitial
          .filter((node) =>
            topicMatches(node, canonicalizeEvidenceTopic(seriesSelection.canonicalQuery)),
          )
          .slice(0, selector.topicSeedLimit);
  if (seeds.length === 0)
    throw new SynthesisEditorialError("No valid current seed node found.", "not-found");
  seeds = [...seeds].sort((left, right) => compareCodeUnits(left.id, right.id));

  const nodes = new Map(seeds.map((node) => [node.id, node]));
  const edges = new Map<string, SubgraphEvidenceSource["edges"][number]>();
  let frontier = seeds.map((node) => node.id);
  for (let depth = 0; depth < selector.depth && frontier.length > 0; depth += 1) {
    const rows = await client.nodeEdge.findMany({
      where: {
        ...publicConfirmedNodeEdgeWhere,
        relationType: { in: selector.relationTypes },
        OR: [
          { sourceNodeVersion: { knowledgeNodeId: { in: frontier } } },
          { targetNodeId: { in: frontier } },
        ],
      },
      orderBy: { id: "asc" },
      take: selector.maxEdges + 1,
      include: {
        sourceNodeVersion: {
          include: {
            snapshot: { select: { commitSha: true } },
            knowledgeNode: {
              include: { repository: { select: { owner: true, name: true, canonicalUrl: true } } },
            },
          },
        },
        targetNode: {
          include: { repository: { select: { owner: true, name: true, canonicalUrl: true } } },
        },
        confirmedTargetNodeVersion: { include: { snapshot: { select: { commitSha: true } } } },
      },
    });
    if (rows.length > selector.maxEdges) {
      throw new SynthesisEditorialError("Edge selection exceeds the configured bound.");
    }
    const endpointIds = [
      ...new Set(rows.flatMap((row) => [row.sourceNodeVersion.knowledgeNodeId, row.targetNodeId])),
    ];
    const currentRows = await loadCurrentNodeRows(client, endpointIds);
    const current = new Map(
      currentRows.flatMap((row) => {
        const mapped = mapEvidenceNode(row);
        return mapped ? [[mapped.id, mapped] as const] : [];
      }),
    );
    const next = new Set<string>();
    for (const row of rows) {
      const source = current.get(row.sourceNodeVersion.knowledgeNodeId);
      const target = current.get(row.targetNodeId);
      if (
        !source ||
        !target ||
        source.versionId !== row.sourceNodeVersionId ||
        target.versionId !== row.confirmedTargetNodeVersionId ||
        !row.confirmedAt
      )
        continue;
      if (!nodes.has(source.id)) next.add(source.id);
      if (!nodes.has(target.id)) next.add(target.id);
      nodes.set(source.id, source);
      nodes.set(target.id, target);
      edges.set(row.id, {
        id: row.id,
        sourceNodeId: source.id,
        sourceVersionId: source.versionId,
        targetNodeId: target.id,
        targetVersionId: target.versionId,
        relationType: row.relationType as SubgraphEvidenceSource["edges"][number]["relationType"],
        status: "confirmed",
        provenance: "confirmed-by-editor",
        rationale: row.rationale ?? undefined,
        assertedAt: row.assertedAt?.toISOString(),
        confirmedAt: row.confirmedAt.toISOString(),
      });
    }
    if (nodes.size > selector.maxNodes || edges.size > selector.maxEdges) {
      throw new SynthesisEditorialError("Selected subgraph exceeds configured bounds.");
    }
    frontier = [...next].sort(compareCodeUnits);
  }

  const selectedNodes = [...nodes.values()].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  );
  const selectedEdges = [...edges.values()]
    .filter((edge) => nodes.has(edge.sourceNodeId) && nodes.has(edge.targetNodeId))
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  const trustByEdge = await loadAuthoritativeTrustByEdge(client, selectedEdges);
  const selection =
    seriesSelection.kind === "seed"
      ? { kind: "seed" as const, nodeId: seeds[0]!.id, versionId: seeds[0]!.versionId }
      : {
          kind: "topic" as const,
          canonicalQuery: canonicalizeEvidenceTopic(seriesSelection.canonicalQuery),
          seedNodeIds: seeds.map((node) => node.id),
        };
  const source: SubgraphEvidenceSource = {
    schemaVersion: "bounded-subgraph/1.0.0",
    selection,
    source: {
      kind: "bounded-supplied-subgraph",
      selectorFingerprint: fingerprintSubgraphEvidenceSelection(selection),
    },
    declaredCounts: {
      nodeCount: selectedNodes.length,
      edgeCount: selectedEdges.length,
      contradictionEdgeIds: selectedEdges
        .filter((edge) => edge.relationType === "contradicts")
        .map((edge) => edge.id),
    },
    nodes: selectedNodes,
    edges: selectedEdges.map((edge) => ({
      ...edge,
      trustAssessments: trustByEdge.get(edge.id) ?? [],
    })),
  };
  return buildPreparedSubgraphEvidencePacket(source);
}

function citationOccurrences(document: SynthesisReviewDocument) {
  const occurrences: Array<{
    location: string;
    sectionId?: string;
    paragraphIndex?: number;
    citationIndex: number;
    citation: SynthesisReviewCitation;
  }> = document.citations.map((citation, citationIndex) => ({
    location: "document",
    citationIndex,
    citation,
  }));
  for (const section of document.sections) {
    section.paragraphs.forEach((paragraph, paragraphIndex) => {
      paragraph.citations.forEach((citation, citationIndex) => {
        occurrences.push({
          location: `sections.${section.id}.paragraphs.${paragraphIndex}`,
          sectionId: section.id,
          paragraphIndex,
          citationIndex,
          citation,
        });
      });
    });
  }
  return occurrences;
}

function assertSelectorPacketBinding(
  selector: SynthesisSelector,
  prepared: PreparedSubgraphEvidencePacket,
) {
  const packetSelection = prepared.packet.selection;
  const matches =
    selector.selection.kind === "seed"
      ? packetSelection.kind === "seed" && packetSelection.nodeId === selector.selection.nodeId
      : packetSelection.kind === "topic" &&
        packetSelection.canonicalQuery === selector.selection.canonicalQuery;
  if (!matches) {
    throw new SynthesisEditorialError(
      "Evidence packet does not match the claimed selector.",
      "conflict",
    );
  }
}

async function verifySuccessfulRun(
  client: PrismaClient,
  result: SynthesisGenerationResult,
  prepared: PreparedSubgraphEvidencePacket,
) {
  const run = await client.agentRun.findUnique({ where: { id: result.runId } });
  const output = canonicalJson(result.document);
  if (
    !run ||
    run.agentType !== "synthesis-review" ||
    run.status !== "succeeded" ||
    run.packetHash !== prepared.sha256 ||
    run.inputHash !== prepared.sha256 ||
    run.inputReferencesJson !== prepared.json ||
    run.promptHash !== result.promptHash ||
    run.promptVersion !== result.promptVersion ||
    run.modelProvider !== result.provider ||
    run.modelName !== result.model ||
    (run.modelVersion ?? "unavailable") !== (result.modelVersion ?? "unavailable") ||
    run.outputJson !== output ||
    digest(output) !== result.documentHash
  ) {
    throw new SynthesisEditorialError(
      "Successful generation provenance does not match.",
      "conflict",
    );
  }
  if (!run.completedAt) {
    throw new SynthesisEditorialError(
      "Successful generation is missing its completion time.",
      "conflict",
    );
  }
  return { ...run, completedAt: run.completedAt };
}

export async function generateSynthesisDraft(
  inputValue: SynthesisGenerationRequest,
  options: GenerateSynthesisDraftOptions = {},
): Promise<EditorialSynthesisDraft> {
  const input = synthesisGenerationRequestSchema.parse(inputValue);
  const client = options.client ?? prisma;
  if (options.actor) assertEditorialActor(options.actor);
  const selectorJson = canonicalJson(input.selector);
  const selectorHash = digest(selectorJson);
  const claimKey = digest(`synthesis-generation-request:${input.requestKey}`);
  const claimNow = options.now?.() ?? new Date();
  const leaseDurationMs = options.leaseDurationMs ?? SYNTHESIS_GENERATION_LEASE_MS;
  const nextLeaseToken = randomUUID();
  const nextLeaseExpiresAt = new Date(claimNow.getTime() + leaseDurationMs);
  const existing = await client.synthesisDraft.findUnique({
    where: { requestKey: input.requestKey },
  });
  if (existing) {
    if (existing.selectorJson !== selectorJson || existing.selectorHash !== selectorHash) {
      throw new SynthesisEditorialError(
        "Request key is already bound to a different selector.",
        "conflict",
      );
    }
    return getEditorialSynthesisDraft(existing.id, client);
  }
  const claimResolution = await runSerializable(() =>
    client.$transaction(
      async (tx) => {
        if (options.actor) {
          const actor = await tx.user.findUnique({ where: { id: options.actor.id } });
          if (!actor || (actor.role !== "EDITOR" && actor.role !== "ADMIN")) {
            throw new SynthesisEditorialError("Editor role required.", "forbidden");
          }
        }
        const claim = await tx.synthesisGenerationRequestClaim.findUnique({
          where: { key: claimKey },
          include: { agentRun: true },
        });
        if (claim) {
          if (
            claim.requestKey !== input.requestKey ||
            claim.selectorJson !== selectorJson ||
            claim.selectorHash !== selectorHash
          ) {
            throw new SynthesisEditorialError(
              "Request key is already bound to a different selector.",
              "conflict",
            );
          }
          if (claim.status === "completed" && claim.draftId) return { draftId: claim.draftId };
          if (claim.agentRun?.status === "succeeded") {
            return { agentRunId: claim.agentRunId };
          }
          const leaseIsCurrent =
            claim.status === "running" &&
            claim.leaseExpiresAt !== null &&
            claim.leaseExpiresAt.getTime() > claimNow.getTime();
          if (leaseIsCurrent) {
            throw new SynthesisEditorialError(
              "This synthesis generation request is already running.",
              "conflict",
            );
          }
          if (claim.agentRun?.status === "running") {
            await tx.agentRun.updateMany({
              where: { id: claim.agentRun.id, status: "running" },
              data: {
                status: "failed",
                completedAt: claimNow,
                error: "lease-expired: Generation owner stopped before completion.",
              },
            });
          }
          const reclaimed = await tx.synthesisGenerationRequestClaim.updateMany({
            where: {
              key: claim.key,
              status: claim.status,
              leaseToken: claim.leaseToken,
              agentRunId: claim.agentRunId,
            },
            data: {
              status: "running",
              agentRunId: null,
              leaseToken: nextLeaseToken,
              leaseExpiresAt: nextLeaseExpiresAt,
              attempt: { increment: 1 },
              errorCode: null,
            },
          });
          if (reclaimed.count !== 1) {
            throw new SynthesisEditorialError(
              "Generation request lease changed concurrently.",
              "conflict",
            );
          }
          return { leaseToken: nextLeaseToken };
        }
        await tx.synthesisGenerationRequestClaim.create({
          data: {
            key: claimKey,
            requestKey: input.requestKey,
            selectorJson,
            selectorHash,
            leaseToken: nextLeaseToken,
            leaseExpiresAt: nextLeaseExpiresAt,
          },
        });
        return { leaseToken: nextLeaseToken };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
  if (claimResolution.draftId) {
    return getEditorialSynthesisDraft(claimResolution.draftId, client);
  }
  if (!claimResolution.agentRunId) await options.afterRequestClaimed?.();

  let prepared: PreparedSubgraphEvidencePacket;
  let result: SynthesisGenerationResult;
  let successfulRun: Awaited<ReturnType<typeof verifySuccessfulRun>>;
  try {
    const resumedRun = claimResolution.agentRunId
      ? await client.agentRun.findUnique({ where: { id: claimResolution.agentRunId } })
      : null;
    prepared = claimResolution.agentRunId
      ? assertCanonicalPreparedPacket({
          packet: JSON.parse(resumedRun?.inputReferencesJson ?? "null") as never,
          json: resumedRun?.inputReferencesJson ?? "",
          sha256: resumedRun?.packetHash ?? "",
        })
      : assertCanonicalPreparedPacket(
          await (
            options.loadPacket ?? ((selector) => loadPreparedSynthesisPacket(selector, client))
          )(input.selector),
        );
    assertSelectorPacketBinding(input.selector, prepared);
    if (claimResolution.agentRunId) {
      const run = resumedRun;
      if (
        !run ||
        run.status !== "succeeded" ||
        !run.outputJson ||
        !run.packetHash ||
        !run.promptHash ||
        !run.promptVersion ||
        !run.modelProvider ||
        !run.modelName
      ) {
        throw new SynthesisEditorialError("Claimed generation run cannot be resumed.", "conflict");
      }
      const document = verifySynthesisDocument(JSON.parse(run.outputJson) as unknown, prepared);
      result = {
        document,
        runId: run.id,
        packetHash: run.packetHash,
        promptHash: run.promptHash,
        documentHash: digest(run.outputJson),
        generationKey: synthesisGenerationKey({
          packetHash: run.packetHash,
          promptVersion: run.promptVersion,
          promptHash: run.promptHash,
          provider: run.modelProvider,
          model: run.modelName,
          modelVersion: run.modelVersion ?? undefined,
        }),
        selectionIdentity: synthesisSelectionIdentity(prepared.packet),
        provider: run.modelProvider,
        model: run.modelName,
        modelVersion: run.modelVersion ?? undefined,
        promptVersion: run.promptVersion,
      };
    } else {
      if (!claimResolution.leaseToken) {
        throw new SynthesisEditorialError("Generation request lease is missing.", "conflict");
      }
      result = await generateSynthesisReview(prepared, options.provider, client, {
        key: claimKey,
        leaseToken: claimResolution.leaseToken,
      });
    }
    verifySynthesisDocument(result.document, prepared);
    successfulRun = await verifySuccessfulRun(client, result, prepared);
    const expectedGenerationKey = synthesisGenerationKey({
      packetHash: prepared.sha256,
      promptVersion: result.promptVersion,
      promptHash: result.promptHash,
      provider: result.provider,
      model: result.model,
      modelVersion: result.modelVersion,
    });
    if (expectedGenerationKey !== result.generationKey) {
      throw new SynthesisEditorialError(
        "Generation identity does not match its canonical inputs.",
        "conflict",
      );
    }
    if (result.selectionIdentity !== synthesisSelectionIdentity(prepared.packet)) {
      throw new SynthesisEditorialError(
        "Generation selection identity does not match its packet.",
        "conflict",
      );
    }
    if (!claimResolution.agentRunId) {
      const boundClaim = await client.synthesisGenerationRequestClaim.findUnique({
        where: { key: claimKey },
        select: { status: true, agentRunId: true },
      });
      if (boundClaim?.status !== "running" || boundClaim.agentRunId !== result.runId) {
        throw new SynthesisEditorialError(
          "Successful run was not atomically bound to its claim.",
          "conflict",
        );
      }
      await options.afterRunClaimed?.();
    }
  } catch (error) {
    const failedClaim = await client.synthesisGenerationRequestClaim.findUnique({
      where: { key: claimKey },
      include: { agentRun: { select: { status: true } } },
    });
    if (!failedClaim?.agentRunId || failedClaim.agentRun?.status === "failed") {
      await client.synthesisGenerationRequestClaim.updateMany({
        where: {
          key: claimKey,
          status: "running",
          leaseToken: claimResolution.leaseToken,
          agentRunId: failedClaim?.agentRunId ?? null,
        },
        data: {
          status: "failed",
          leaseToken: null,
          leaseExpiresAt: null,
          errorCode: error instanceof Error ? error.name : "generation-failed",
        },
      });
    }
    throw error;
  }
  const seriesKey = synthesisSeriesKey(input.selector);

  try {
    const draftId = await client.$transaction(
      async (tx) => {
        const duplicate = await tx.synthesisDraft.findUnique({
          where: { requestKey: input.requestKey },
        });
        if (duplicate) return duplicate.id;
        const latest = await tx.synthesisDraft.findFirst({
          where: { seriesKey },
          orderBy: { regenerationOrdinal: "desc" },
        });
        const seriesReview = await tx.review.findUnique({
          where: { synthesisSeriesKey: seriesKey },
          include: {
            currentSynthesisVersion: {
              select: {
                id: true,
                reviewId: true,
                recordSourceType: true,
                snapshotId: true,
                synthesisOrdinal: true,
                synthesisDraftId: true,
                synthesisDraft: { select: { seriesKey: true, status: true, reviewId: true } },
              },
            },
          },
        });
        const previousAccepted = seriesReview?.currentSynthesisVersion;
        if (
          seriesReview &&
          (seriesReview.reviewType !== "ai-synthesis" ||
            seriesReview.repositoryId !== null ||
            seriesReview.currentSnapshotId !== null ||
            !previousAccepted ||
            previousAccepted.reviewId !== seriesReview.id ||
            previousAccepted.recordSourceType !== "synthesis" ||
            previousAccepted.snapshotId !== null ||
            !previousAccepted.synthesisOrdinal ||
            !previousAccepted.synthesisDraftId ||
            previousAccepted.synthesisDraft?.seriesKey !== seriesKey ||
            previousAccepted.synthesisDraft.status !== "accepted" ||
            previousAccepted.synthesisDraft.reviewId !== seriesReview.id)
        ) {
          throw new SynthesisEditorialError(
            "Current synthesis series head is invalid.",
            "conflict",
          );
        }
        const regenerationOrdinal = (latest?.regenerationOrdinal ?? 0) + 1;
        const references = new Map(
          prepared.packet.references.map((reference) => [reference.referenceId, reference]),
        );
        const nodes = new Map(prepared.packet.nodes.map((node) => [node.id, node]));
        const occurrences = citationOccurrences(result.document);
        const draft = await tx.synthesisDraft.create({
          data: {
            seriesKey,
            selectorJson,
            selectorHash,
            materializationPolicyVersion: SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
            generationKey: result.generationKey,
            regenerationOrdinal,
            parentDraftId: latest?.status === "regeneration-requested" ? latest.id : undefined,
            previousAcceptedDraftId: previousAccepted?.synthesisDraftId ?? undefined,
            previousAcceptedOrdinal: previousAccepted?.synthesisOrdinal ?? undefined,
            agentRunId: result.runId,
            packetJson: prepared.json,
            packetHash: result.packetHash,
            documentJson: canonicalJson(result.document),
            documentHash: result.documentHash,
            generationMode: result.provider === "deterministic" ? "deterministic-template" : "llm",
            pipelineSoftwareId: SYNTHESIS_PIPELINE_SOFTWARE_ID,
            pipelineSoftwareKind: "software-agent",
            pipelineSoftwareName: SYNTHESIS_PIPELINE_SOFTWARE_NAME,
            pipelineSoftwareVersion: SYNTHESIS_PIPELINE_VERSION,
            provider: result.provider,
            model: result.model,
            modelVersion: result.modelVersion ?? "unavailable",
            promptVersion: result.promptVersion,
            promptHash: result.promptHash,
            generatedAt: successfulRun.completedAt,
            attributionPolicyVersion: SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
            requestKey: input.requestKey,
            memberships: {
              create: prepared.packet.references.map((reference, position) => ({
                referenceId: reference.referenceId,
                kind: reference.kind,
                nodeId: reference.nodeId,
                nodeVersionId: reference.nodeVersionId,
                identifierScheme: reference.kind === "identifier" ? reference.scheme : undefined,
                identifierRole: reference.kind === "identifier" ? reference.role : undefined,
                identifierValue: reference.kind === "identifier" ? reference.value : undefined,
                position,
              })),
            },
            citations: {
              create: occurrences.map((occurrence) => {
                const reference = references.get(occurrence.citation.referenceId)!;
                const node = nodes.get(occurrence.citation.nodeId)!;
                return {
                  occurrenceKey: `${occurrence.location}:${occurrence.citationIndex}`,
                  location: occurrence.location,
                  sectionId: occurrence.sectionId,
                  paragraphIndex: occurrence.paragraphIndex,
                  citationIndex: occurrence.citationIndex,
                  referenceId: occurrence.citation.referenceId,
                  nodeId: occurrence.citation.nodeId,
                  nodeVersionId: occurrence.citation.nodeVersionId,
                  nodeKind: node.kind,
                  nodeTitle: node.title,
                  identifierScheme: reference.kind === "identifier" ? reference.scheme : undefined,
                  identifierRole: reference.kind === "identifier" ? reference.role : undefined,
                  identifierValue: reference.kind === "identifier" ? reference.value : undefined,
                };
              }),
            },
          },
        });
        await tx.auditEvent.create({
          data: {
            actorId: options.actor?.id,
            action: "synthesis.draft.generated",
            subjectType: "synthesisDraft",
            subjectId: draft.id,
            idempotencyKey: `synthesis-generation:${input.requestKey}`,
            detailsJson: canonicalJson({
              seriesKey,
              regenerationOrdinal,
              packetHash: result.packetHash,
              documentHash: result.documentHash,
            }),
          },
        });
        const completed = await tx.synthesisGenerationRequestClaim.updateMany({
          where: { key: claimKey, status: "running", selectorHash, agentRunId: result.runId },
          data: {
            status: "completed",
            draftId: draft.id,
            leaseToken: null,
            leaseExpiresAt: null,
            errorCode: null,
          },
        });
        if (completed.count !== 1) {
          throw new SynthesisEditorialError(
            "Generation request claim changed concurrently.",
            "conflict",
          );
        }
        return draft.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return getEditorialSynthesisDraft(draftId, client);
  } catch (error) {
    const duplicate = await client.synthesisDraft.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (duplicate) return getEditorialSynthesisDraft(duplicate.id, client);
    throw mapTransactionError(error);
  }
}

function parseStoredPrepared(row: {
  packetJson: string;
  packetHash: string;
}): PreparedSubgraphEvidencePacket {
  let value: unknown;
  try {
    value = JSON.parse(row.packetJson);
  } catch {
    throw new SynthesisEditorialError("Stored evidence packet is invalid.", "conflict");
  }
  const parsed = subgraphEvidencePacketSchema.safeParse(value);
  if (!parsed.success)
    throw new SynthesisEditorialError("Stored evidence packet is invalid.", "conflict");
  return assertCanonicalPreparedPacket({
    packet: parsed.data,
    json: row.packetJson,
    sha256: row.packetHash,
  });
}

function parseStoredDocument(
  row: { documentJson: string; documentHash: string },
  prepared: PreparedSubgraphEvidencePacket,
) {
  let value: unknown;
  try {
    value = JSON.parse(row.documentJson);
  } catch {
    throw new SynthesisEditorialError("Stored synthesis document is invalid.", "conflict");
  }
  const document = verifySynthesisDocument(value, prepared);
  if (
    canonicalJson(document) !== row.documentJson ||
    digest(row.documentJson) !== row.documentHash
  ) {
    throw new SynthesisEditorialError("Stored synthesis document hash does not match.", "conflict");
  }
  return document;
}

async function loadDraft(client: PrismaClient, id: string) {
  return client.synthesisDraft.findUnique({
    where: { id },
    include: {
      agentRun: true,
      acceptedBy: { select: { githubLogin: true, displayName: true, role: true } },
      memberships: {
        orderBy: { position: "asc" },
        include: { nodeVersion: { select: { knowledgeNodeId: true } } },
      },
      citations: {
        orderBy: [{ location: "asc" }, { citationIndex: "asc" }],
        include: { nodeVersion: { select: { knowledgeNodeId: true } } },
      },
      reviewVersion: { select: { id: true, synthesisOrdinal: true } },
    },
  });
}

type LoadedDraft = NonNullable<Awaited<ReturnType<typeof loadDraft>>>;

function assertDraftIntegrity(row: LoadedDraft) {
  const prepared = parseStoredPrepared(row);
  const document = parseStoredDocument(row, prepared);
  const selector = synthesisSelectorSchema.safeParse(JSON.parse(row.selectorJson) as unknown);
  if (
    !selector.success ||
    canonicalJson(selector.data) !== row.selectorJson ||
    digest(row.selectorJson) !== row.selectorHash ||
    synthesisSeriesKey(selector.data) !== row.seriesKey
  ) {
    throw new SynthesisEditorialError("Stored synthesis selector does not match.", "conflict");
  }
  const run = row.agentRun;
  if (
    run.status !== "succeeded" ||
    run.agentType !== "synthesis-review" ||
    run.packetHash !== row.packetHash ||
    run.inputHash !== row.packetHash ||
    run.inputReferencesJson !== row.packetJson ||
    run.outputJson !== row.documentJson ||
    run.promptVersion !== row.promptVersion ||
    run.promptHash !== row.promptHash ||
    run.modelProvider !== row.provider ||
    run.modelName !== row.model ||
    (run.modelVersion ?? "unavailable") !== row.modelVersion ||
    !run.completedAt ||
    run.completedAt.getTime() !== row.generatedAt.getTime() ||
    synthesisGenerationKey({
      packetHash: row.packetHash,
      promptVersion: row.promptVersion,
      promptHash: row.promptHash,
      provider: row.provider,
      model: row.model,
      modelVersion: run.modelVersion ?? undefined,
    }) !== row.generationKey
  ) {
    throw new SynthesisEditorialError("Stored AgentRun does not match the draft.", "conflict");
  }
  const references = new Map(
    prepared.packet.references.map((reference) => [reference.referenceId, reference]),
  );
  if (row.memberships.length !== references.size) {
    throw new SynthesisEditorialError("Stored draft membership is incomplete.", "conflict");
  }
  for (const membership of row.memberships) {
    const reference = references.get(membership.referenceId);
    const hasStoredIdentifier =
      membership.identifierScheme !== null ||
      membership.identifierRole !== null ||
      membership.identifierValue !== null;
    if (
      !reference ||
      membership.nodeVersion.knowledgeNodeId !== membership.nodeId ||
      reference.kind !== membership.kind ||
      reference.nodeId !== membership.nodeId ||
      reference.nodeVersionId !== membership.nodeVersionId ||
      (reference.kind === "node" && hasStoredIdentifier) ||
      (reference.kind === "identifier" &&
        (reference.scheme !== membership.identifierScheme ||
          reference.role !== membership.identifierRole ||
          reference.value !== membership.identifierValue))
    ) {
      throw new SynthesisEditorialError(
        "Stored draft membership does not match the packet.",
        "conflict",
      );
    }
  }
  const expectedOccurrences = citationOccurrences(document);
  if (expectedOccurrences.length !== row.citations.length) {
    throw new SynthesisEditorialError("Stored citation occurrences are incomplete.", "conflict");
  }
  const occurrenceByKey = new Map(
    row.citations.map((citation) => [`${citation.location}:${citation.citationIndex}`, citation]),
  );
  for (const occurrence of expectedOccurrences) {
    const stored = occurrenceByKey.get(`${occurrence.location}:${occurrence.citationIndex}`);
    const reference = references.get(occurrence.citation.referenceId);
    const node = prepared.packet.nodes.find(
      (candidate) => candidate.id === occurrence.citation.nodeId,
    );
    const hasStoredIdentifier =
      stored?.identifierScheme !== null ||
      stored?.identifierRole !== null ||
      stored?.identifierValue !== null;
    if (
      !stored ||
      !reference ||
      !node ||
      stored.nodeVersion.knowledgeNodeId !== stored.nodeId ||
      stored.referenceId !== occurrence.citation.referenceId ||
      stored.nodeId !== occurrence.citation.nodeId ||
      stored.nodeVersionId !== occurrence.citation.nodeVersionId ||
      stored.nodeKind !== node.kind ||
      stored.nodeTitle !== node.title ||
      (reference.kind === "node" && hasStoredIdentifier) ||
      (reference.kind === "identifier" &&
        (stored.identifierScheme !== reference.scheme ||
          stored.identifierRole !== reference.role ||
          stored.identifierValue !== reference.value))
    ) {
      throw new SynthesisEditorialError("Stored citation occurrence does not match.", "conflict");
    }
  }
  return { prepared, document, selector: selector.data };
}

function draftProvenance(row: LoadedDraft) {
  return {
    generationMode: row.generationMode as "llm" | "deterministic-template",
    pipelineSoftware: {
      id: row.pipelineSoftwareId as typeof SYNTHESIS_PIPELINE_SOFTWARE_ID,
      kind: row.pipelineSoftwareKind as "software-agent",
      displayName: row.pipelineSoftwareName as typeof SYNTHESIS_PIPELINE_SOFTWARE_NAME,
      pipelineVersion: row.pipelineSoftwareVersion,
    },
    provider: row.provider,
    model: row.model,
    modelVersion: row.modelVersion,
    promptVersion: row.promptVersion,
    promptHash: row.promptHash,
    packetHash: row.packetHash,
    documentHash: row.documentHash,
    generatedAt: row.generatedAt.toISOString(),
    attributionPolicyVersion: row.attributionPolicyVersion,
    materializationPolicyVersion: row.materializationPolicyVersion,
  };
}

function draftCitationDtos(row: LoadedDraft) {
  return row.citations.map((citation, occurrenceOrdinal) => ({
    referenceId: citation.referenceId,
    nodeId: citation.nodeId,
    nodeVersionId: citation.nodeVersionId,
    nodeKind: citation.nodeKind as "claim" | "figure" | "dataset" | "code",
    title: citation.nodeTitle,
    location: citation.location,
    occurrenceOrdinal,
    identifierScheme: citation.identifierScheme ?? undefined,
    identifierRole: citation.identifierRole ?? undefined,
    identifierValue: citation.identifierValue ?? undefined,
  }));
}

export async function getEditorialSynthesisDraft(
  id: string,
  client: PrismaClient = prisma,
): Promise<EditorialSynthesisDraft> {
  const row = await loadDraft(client, id);
  if (!row) throw new SynthesisEditorialError("Synthesis draft not found.", "not-found");
  const { document, selector } = assertDraftIntegrity(row);
  return editorialSynthesisDraftSchema.parse({
    id: row.id,
    status: row.status,
    revision: row.revision,
    seriesKey: row.seriesKey,
    selector,
    generationKey: row.generationKey,
    regenerationOrdinal: row.regenerationOrdinal,
    parentDraftId: row.parentDraftId ?? undefined,
    previousAcceptedOrdinal: row.previousAcceptedOrdinal ?? undefined,
    document,
    provenance: draftProvenance(row),
    citations: draftCitationDtos(row),
  });
}

export async function listEditorialSynthesisDrafts(
  client: PrismaClient = prisma,
): Promise<EditorialSynthesisDraft[]> {
  const rows = await client.synthesisDraft.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return Promise.all(rows.map((row) => getEditorialSynthesisDraft(row.id, client)));
}

function assertEditorialActor(
  actor: SessionUser,
): asserts actor is SessionUser & { role: "EDITOR" | "ADMIN" } {
  if (actor.role !== "EDITOR" && actor.role !== "ADMIN") {
    throw new SynthesisEditorialError("Editor role required.", "forbidden");
  }
}

async function runSerializable<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SYNTHESIS_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : undefined;
      if (!["P1008", "P2002", "P2028", "P2034"].includes(code ?? "")) throw error;
    }
  }
  throw mapTransactionError(lastError);
}

function mapTransactionError(error: unknown): Error {
  if (error instanceof SynthesisEditorialError) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  if (["P1008", "P2002", "P2028", "P2034"].includes(code ?? "")) {
    return new SynthesisEditorialError(
      "Synthesis state changed concurrently; reload and retry.",
      "conflict",
    );
  }
  return error instanceof Error ? error : new Error("Synthesis transaction failed.");
}

function slugForSeries(seriesKey: string): string {
  return `synthesis-${seriesKey.slice(0, 20)}`;
}

export async function decideSynthesisDraft(
  draftId: string,
  inputValue: SynthesisDraftDecision,
  actor: SessionUser,
  client: PrismaClient = prisma,
): Promise<{ status: string; revision: number; reviewSlug?: string; reviewVersionId?: string }> {
  assertEditorialActor(actor);
  const input = synthesisDraftDecisionSchema.parse(inputValue);
  const operationKey = `synthesis-decision:${draftId}:${input.idempotencyKey}`;
  const operationHash = digest(canonicalJson(input));

  return runSerializable(() =>
    client.$transaction(
      async (tx) => {
        const currentActor = await tx.user.findUnique({ where: { id: actor.id } });
        if (!currentActor || (currentActor.role !== "EDITOR" && currentActor.role !== "ADMIN")) {
          throw new SynthesisEditorialError("Editor role required.", "forbidden");
        }
        const priorClaim = await tx.idempotencyKey.findUnique({ where: { key: operationKey } });
        const draft = await tx.synthesisDraft.findUnique({
          where: { id: draftId },
          include: {
            agentRun: true,
            memberships: {
              orderBy: { position: "asc" },
              include: { nodeVersion: { select: { knowledgeNodeId: true } } },
            },
            citations: {
              orderBy: [{ location: "asc" }, { citationIndex: "asc" }],
              include: { nodeVersion: { select: { knowledgeNodeId: true } } },
            },
            acceptedBy: { select: { githubLogin: true, displayName: true, role: true } },
            reviewVersion: {
              select: { id: true, synthesisOrdinal: true, review: { select: { slug: true } } },
            },
          },
        });
        if (!draft) throw new SynthesisEditorialError("Synthesis draft not found.", "not-found");
        if (priorClaim) {
          if (priorClaim.requestHash !== operationHash) {
            throw new SynthesisEditorialError(
              "Idempotency key is bound to a different decision.",
              "conflict",
            );
          }
          return {
            status: draft.status,
            revision: draft.revision,
            reviewSlug: draft.reviewVersion?.review.slug,
            reviewVersionId: draft.reviewVersion?.id,
          };
        }
        if (draft.status !== "pending" || draft.revision !== input.expectedRevision) {
          throw new SynthesisEditorialError("Draft changed; reload before deciding.", "conflict");
        }
        // Reuse the same fail-closed checks on the transaction snapshot.
        const integrity = assertDraftIntegrity(draft as LoadedDraft);
        await tx.idempotencyKey.create({ data: { key: operationKey, requestHash: operationHash } });
        const nextRevision = draft.revision + 1;
        const claimed = await tx.synthesisDraft.updateMany({
          where: { id: draft.id, status: "pending", revision: input.expectedRevision },
          data: { revision: nextRevision },
        });
        if (claimed.count !== 1) {
          throw new SynthesisEditorialError(
            "Draft changed concurrently; reload and retry.",
            "conflict",
          );
        }

        if (input.action !== "accept") {
          const status = input.action === "reject" ? "rejected" : "regeneration-requested";
          await tx.synthesisDraft.update({
            where: { id: draft.id },
            data: { status, decisionRationale: input.rationale },
          });
          await tx.agentRun.update({
            where: { id: draft.agentRunId },
            data: { humanReviewStatus: "rejected" },
          });
          await tx.auditEvent.create({
            data: {
              actorId: currentActor.id,
              action:
                input.action === "reject"
                  ? "synthesis.draft.rejected"
                  : "synthesis.draft.regeneration-requested",
              subjectType: "synthesisDraft",
              subjectId: draft.id,
              idempotencyKey: operationKey,
              detailsJson: canonicalJson({ revision: nextRevision, rationale: input.rationale }),
            },
          });
          return { status, revision: nextRevision };
        }

        const existingReview = await tx.review.findUnique({
          where: { synthesisSeriesKey: draft.seriesKey },
          include: {
            currentSynthesisVersion: {
              select: {
                id: true,
                reviewId: true,
                recordSourceType: true,
                synthesisOrdinal: true,
                synthesisDraftId: true,
                acceptedPredecessorVersionId: true,
                versionDoi: true,
                conceptDoi: true,
                synthesisDraft: {
                  select: {
                    id: true,
                    status: true,
                    reviewId: true,
                    versionDoi: true,
                    conceptDoi: true,
                  },
                },
              },
            },
          },
        });
        const previousVersion = existingReview?.currentSynthesisVersion;
        if (
          existingReview &&
          (!previousVersion ||
            existingReview.reviewType !== "ai-synthesis" ||
            existingReview.repositoryId !== null ||
            existingReview.currentSnapshotId !== null ||
            previousVersion.reviewId !== existingReview.id ||
            previousVersion.recordSourceType !== "synthesis" ||
            !previousVersion.synthesisOrdinal ||
            !previousVersion.synthesisDraftId)
        ) {
          throw new SynthesisEditorialError(
            "Current synthesis head has invalid source lineage.",
            "conflict",
          );
        }
        if (
          (draft.previousAcceptedDraftId ?? null) !== (previousVersion?.synthesisDraftId ?? null)
        ) {
          throw new SynthesisEditorialError(
            "Draft was generated from a stale accepted synthesis head.",
            "conflict",
          );
        }
        let canonicalSeriesConceptDoi: string | null = null;
        if (existingReview && previousVersion) {
          const acceptedHistory = await tx.reviewVersion.findMany({
            where: { reviewId: existingReview.id, recordSourceType: "synthesis" },
            orderBy: { synthesisOrdinal: "asc" },
            select: {
              id: true,
              synthesisOrdinal: true,
              versionDoi: true,
              conceptDoi: true,
              synthesisDraft: {
                select: {
                  id: true,
                  status: true,
                  reviewId: true,
                  versionDoi: true,
                  conceptDoi: true,
                },
              },
            },
          });
          const historicalConcepts = new Set<string>();
          if (acceptedHistory.at(-1)?.id !== previousVersion.id) {
            throw new SynthesisEditorialError(
              "Current synthesis head is not the latest accepted series version.",
              "conflict",
            );
          }
          for (const acceptedVersion of acceptedHistory) {
            const acceptedDraft = acceptedVersion.synthesisDraft;
            const doiPair = liveSynthesisDoiPairSchema.safeParse({
              versionDoi: acceptedVersion.versionDoi ?? undefined,
              conceptDoi: acceptedVersion.conceptDoi ?? undefined,
            });
            if (
              !acceptedVersion.synthesisOrdinal ||
              !acceptedDraft ||
              acceptedDraft.status !== "accepted" ||
              acceptedDraft.reviewId !== existingReview.id ||
              acceptedVersion.versionDoi !== acceptedDraft.versionDoi ||
              acceptedVersion.conceptDoi !== acceptedDraft.conceptDoi ||
              !doiPair.success ||
              (doiPair.data.versionDoi ?? null) !== acceptedVersion.versionDoi ||
              (doiPair.data.conceptDoi ?? null) !== acceptedVersion.conceptDoi
            ) {
              throw new SynthesisEditorialError(
                "Accepted synthesis DOI lineage is corrupt.",
                "conflict",
              );
            }
            if (acceptedVersion.conceptDoi) historicalConcepts.add(acceptedVersion.conceptDoi);
          }
          if (historicalConcepts.size > 1) {
            throw new SynthesisEditorialError(
              "Accepted synthesis history has inconsistent concept DOI roles.",
              "conflict",
            );
          }
          canonicalSeriesConceptDoi = historicalConcepts.values().next().value ?? null;
          if ((previousVersion.conceptDoi ?? null) !== canonicalSeriesConceptDoi) {
            throw new SynthesisEditorialError(
              "Current synthesis head does not match the canonical series concept DOI.",
              "conflict",
            );
          }
        }
        const ordinal = (previousVersion?.synthesisOrdinal ?? 0) + 1;
        const slug = slugForSeries(draft.seriesKey);
        if (previousVersion && canonicalSeriesConceptDoi !== (input.conceptDoi ?? null)) {
          throw new SynthesisEditorialError(
            "Concept DOI must remain stable for the synthesis series.",
            "conflict",
          );
        }
        if (input.versionDoi) {
          const reused = await tx.reviewVersion.findFirst({
            where: {
              recordSourceType: "synthesis",
              OR: [{ versionDoi: input.versionDoi }, { conceptDoi: input.versionDoi }],
            },
            select: { id: true },
          });
          if (reused) {
            throw new SynthesisEditorialError(
              "Version DOI is already assigned to a synthesis identifier.",
              "conflict",
            );
          }
        }
        if (input.conceptDoi) {
          const crossRole = await tx.reviewVersion.findFirst({
            where: { recordSourceType: "synthesis", versionDoi: input.conceptDoi },
            select: { id: true },
          });
          const otherSeries = await tx.reviewVersion.findFirst({
            where: {
              recordSourceType: "synthesis",
              conceptDoi: input.conceptDoi,
              ...(existingReview ? { reviewId: { not: existingReview.id } } : {}),
            },
            select: { id: true },
          });
          if (crossRole || otherSeries) {
            throw new SynthesisEditorialError(
              "Concept DOI is already assigned to another synthesis role or series.",
              "conflict",
            );
          }
        }
        let review = existingReview;
        if (!review) {
          review = await tx.review.create({
            data: {
              slug,
              synthesisSeriesKey: draft.seriesKey,
              title: integrity.document.title,
              abstract: integrity.document.summary,
              reviewType: "ai-synthesis",
              licenseSpdx: input.licenseSpdx,
              status: "published",
              acceptedAt: new Date(),
            },
            include: {
              currentSynthesisVersion: {
                select: {
                  id: true,
                  reviewId: true,
                  recordSourceType: true,
                  synthesisOrdinal: true,
                  synthesisDraftId: true,
                  acceptedPredecessorVersionId: true,
                  versionDoi: true,
                  conceptDoi: true,
                  synthesisDraft: {
                    select: {
                      id: true,
                      status: true,
                      reviewId: true,
                      versionDoi: true,
                      conceptDoi: true,
                    },
                  },
                },
              },
            },
          });
        }
        if (
          review.repositoryId ||
          review.currentSnapshotId ||
          review.reviewType !== "ai-synthesis"
        ) {
          throw new SynthesisEditorialError(
            "Review source identity is not a synthesis series.",
            "conflict",
          );
        }
        const acceptedAt = new Date();
        const version = await tx.reviewVersion.create({
          data: {
            reviewId: review.id,
            recordSourceType: "synthesis",
            synthesisDraftId: draft.id,
            sourceSelectionKey: `${draft.seriesKey}:${ordinal}`,
            title: integrity.document.title,
            abstract: integrity.document.summary,
            metadataJson: canonicalJson({ reviewType: "ai-synthesis", license: input.licenseSpdx }),
            isExample: false,
            publishedAt: acceptedAt,
            synthesisDocumentJson: draft.documentJson,
            synthesisOrdinal: ordinal,
            synthesisGenerationMode: draft.generationMode,
            synthesisPipelineId: draft.pipelineSoftwareId,
            synthesisPipelineKind: draft.pipelineSoftwareKind,
            synthesisPipelineName: draft.pipelineSoftwareName,
            synthesisPipelineVersion: draft.pipelineSoftwareVersion,
            synthesisProvider: draft.provider,
            synthesisModel: draft.model,
            synthesisModelVersion: draft.modelVersion,
            synthesisPromptVersion: draft.promptVersion,
            synthesisPromptHash: draft.promptHash,
            synthesisPacketHash: draft.packetHash,
            synthesisDocumentHash: draft.documentHash,
            synthesisGeneratedAt: draft.generatedAt,
            synthesisAcceptedAt: acceptedAt,
            synthesisApprovedById: currentActor.id,
            synthesisApproverRole: currentActor.role,
            synthesisApproverDisplayName: currentActor.displayName ?? currentActor.githubLogin,
            synthesisApproverGithubLogin: currentActor.githubLogin,
            synthesisChecklistVersion: SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
            synthesisAttributionPolicyVersion: SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
            synthesisMaterializationPolicyVersion: SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
            synthesisRightsStatement: input.rightsStatement,
            synthesisLicenseSpdx: input.licenseSpdx,
            versionDoi: input.versionDoi,
            conceptDoi: input.conceptDoi,
            acceptedPredecessorVersionId: previousVersion?.id,
            synthesisAttributions: {
              create: [
                {
                  position: 0,
                  kind: "software-agent",
                  displayName: draft.pipelineSoftwareName,
                  role: "synthesis-generation",
                  softwareVersion: draft.pipelineSoftwareVersion,
                },
                {
                  position: 1,
                  kind: "approving-editor",
                  displayName: currentActor.displayName ?? currentActor.githubLogin,
                  role: "editorial-approval",
                  userId: currentActor.id,
                  userRoleSnapshot: currentActor.role,
                  githubLoginSnapshot: currentActor.githubLogin,
                },
              ],
            },
          },
        });
        await tx.review.update({
          where: { id: review.id },
          data: {
            currentSynthesisVersionId: version.id,
            title: version.title,
            abstract: version.abstract,
            licenseSpdx: input.licenseSpdx,
            acceptedAt,
          },
        });
        const supersededRegenerationProposals = await tx.synthesisRegenerationProposal.findMany({
          where: {
            reviewId: review.id,
            status: "open",
            acceptedReviewVersionId: { not: version.id },
          },
          select: { id: true, acceptedReviewVersionId: true },
        });
        await tx.synthesisRegenerationProposal.updateMany({
          where: {
            reviewId: review.id,
            status: "open",
            acceptedReviewVersionId: { not: version.id },
          },
          data: { status: "superseded", openHeadKey: null },
        });
        await tx.synthesisDraft.update({
          where: { id: draft.id },
          data: {
            status: "accepted",
            acceptedAt,
            acceptedById: currentActor.id,
            acceptedByRoleSnapshot: currentActor.role,
            acceptedByDisplayName: currentActor.displayName ?? currentActor.githubLogin,
            acceptedByGithubLogin: currentActor.githubLogin,
            decisionRationale: input.rationale,
            checklistJson: canonicalJson(input.checklist),
            checklistVersion: SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
            rightsStatement: input.rightsStatement,
            licenseSpdx: input.licenseSpdx,
            versionDoi: input.versionDoi,
            conceptDoi: input.conceptDoi,
            reviewId: review.id,
          },
        });
        await tx.agentRun.update({
          where: { id: draft.agentRunId },
          data: { humanReviewStatus: "approved" },
        });
        await tx.auditEvent.createMany({
          data: [
            {
              actorId: currentActor.id,
              action: "synthesis.draft.accepted",
              subjectType: "synthesisDraft",
              subjectId: draft.id,
              idempotencyKey: operationKey,
              detailsJson: canonicalJson({
                reviewId: review.id,
                reviewVersionId: version.id,
                ordinal,
              }),
            },
            {
              actorId: currentActor.id,
              action: "review.synthesis-published",
              subjectType: "reviewVersion",
              subjectId: version.id,
              idempotencyKey: `${operationKey}:published`,
              detailsJson: canonicalJson({
                reviewSlug: review.slug,
                seriesKey: draft.seriesKey,
                ordinal,
              }),
            },
            ...supersededRegenerationProposals.map((proposal) => ({
              actorId: currentActor.id,
              action: "synthesis.regeneration-proposal.superseded",
              subjectType: "synthesisRegenerationProposal",
              subjectId: proposal.id,
              idempotencyKey: `synthesis-staleness:proposal:${proposal.id}:superseded:head:${version.id}`,
              detailsJson: canonicalJson({
                cause: "accepted-head-changed",
                reviewId: review.id,
                previousAcceptedReviewVersionId: proposal.acceptedReviewVersionId,
                currentAcceptedReviewVersionId: version.id,
              }),
            })),
          ],
        });
        return {
          status: "accepted",
          revision: nextRevision,
          reviewSlug: review.slug,
          reviewVersionId: version.id,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function getPublicSynthesisReview(
  slug: string,
  client: PrismaClient = prisma,
): Promise<PublicSynthesisReview | null> {
  const review = await client.review.findUnique({
    where: { slug },
    include: {
      currentSynthesisVersion: {
        include: {
          acceptedPredecessor: {
            select: {
              id: true,
              reviewId: true,
              recordSourceType: true,
              synthesisOrdinal: true,
              synthesisDraftId: true,
            },
          },
          synthesisAttributions: { orderBy: { position: "asc" } },
          synthesisStalenessHead: {
            include: { currentEvaluation: true },
          },
          synthesisDraft: {
            include: {
              agentRun: true,
              acceptedBy: { select: { githubLogin: true, displayName: true, role: true } },
              memberships: {
                orderBy: { position: "asc" },
                include: { nodeVersion: { select: { knowledgeNodeId: true } } },
              },
              citations: {
                orderBy: [{ location: "asc" }, { citationIndex: "asc" }],
                include: { nodeVersion: { select: { knowledgeNodeId: true } } },
              },
              reviewVersion: { select: { id: true, synthesisOrdinal: true } },
            },
          },
        },
      },
    },
  });
  if (!review) return null;
  const version = review.currentSynthesisVersion;
  if (
    review.reviewType !== "ai-synthesis" ||
    review.status !== "published" ||
    review.repositoryId ||
    review.currentSnapshotId ||
    review.synthesisSeriesKey !== version?.synthesisDraft?.seriesKey ||
    review.currentSynthesisVersionId !== version?.id ||
    !version ||
    version.reviewId !== review.id ||
    version.recordSourceType !== "synthesis" ||
    version.snapshotId ||
    version.isExample !== false ||
    version.publicState !== "published" ||
    !version.synthesisDraft ||
    version.synthesisDraft.status !== "accepted" ||
    version.synthesisDraft.reviewId !== review.id ||
    version.synthesisDraft.reviewVersion?.id !== version.id ||
    version.synthesisDraft.reviewVersion?.synthesisOrdinal !== version.synthesisOrdinal
  )
    return null;

  const draft = version.synthesisDraft as LoadedDraft;
  let integrity: ReturnType<typeof assertDraftIntegrity>;
  let checklistIsValid = false;
  try {
    integrity = assertDraftIntegrity(draft);
    checklistIsValid =
      draft.checklistVersion !== null &&
      draft.checklistJson !== null &&
      isSupportedSynthesisAcceptanceChecklist(
        draft.checklistVersion,
        JSON.parse(draft.checklistJson),
      );
  } catch {
    return null;
  }
  const predecessor = version.acceptedPredecessor;
  const ordinal = version.synthesisOrdinal;
  const editorAttribution = version.synthesisAttributions.find(
    (entry) => entry.kind === "approving-editor",
  );
  const softwareAttribution = version.synthesisAttributions.find(
    (entry) => entry.kind === "software-agent",
  );
  if (
    !ordinal ||
    version.synthesisDocumentJson !== draft.documentJson ||
    version.synthesisDraftId !== draft.id ||
    version.sourceSelectionKey !== `${draft.seriesKey}:${ordinal}` ||
    version.title !== integrity.document.title ||
    version.abstract !== integrity.document.summary ||
    version.synthesisDocumentHash !== draft.documentHash ||
    version.synthesisPacketHash !== draft.packetHash ||
    version.synthesisPromptHash !== draft.promptHash ||
    version.synthesisPromptVersion !== draft.promptVersion ||
    version.synthesisGenerationMode !== draft.generationMode ||
    version.synthesisPipelineId !== draft.pipelineSoftwareId ||
    version.synthesisPipelineKind !== draft.pipelineSoftwareKind ||
    version.synthesisPipelineName !== draft.pipelineSoftwareName ||
    version.synthesisPipelineVersion !== draft.pipelineSoftwareVersion ||
    version.synthesisProvider !== draft.provider ||
    version.synthesisModel !== draft.model ||
    version.synthesisModelVersion !== draft.modelVersion ||
    version.synthesisAttributionPolicyVersion !== draft.attributionPolicyVersion ||
    version.synthesisMaterializationPolicyVersion !== draft.materializationPolicyVersion ||
    !checklistIsValid ||
    version.synthesisChecklistVersion !== draft.checklistVersion ||
    version.synthesisRightsStatement !== draft.rightsStatement ||
    version.synthesisLicenseSpdx !== draft.licenseSpdx ||
    version.versionDoi !== draft.versionDoi ||
    version.conceptDoi !== draft.conceptDoi ||
    version.synthesisGeneratedAt?.getTime() !== draft.generatedAt.getTime() ||
    !version.synthesisAcceptedAt ||
    !version.synthesisApproverRole ||
    !version.synthesisApproverDisplayName ||
    !version.synthesisApproverGithubLogin ||
    !version.synthesisRightsStatement ||
    !version.synthesisLicenseSpdx ||
    draft.acceptedAt?.getTime() !== version.synthesisAcceptedAt.getTime() ||
    draft.acceptedByRoleSnapshot !== version.synthesisApproverRole ||
    draft.acceptedByDisplayName !== version.synthesisApproverDisplayName ||
    draft.acceptedByGithubLogin !== version.synthesisApproverGithubLogin ||
    draft.agentRun.humanReviewStatus !== "approved" ||
    version.synthesisApprovedById === null ||
    version.synthesisApprovedById !== draft.acceptedById ||
    (version.synthesisApproverRole !== "EDITOR" && version.synthesisApproverRole !== "ADMIN") ||
    (ordinal === 1 ? predecessor !== null : !predecessor) ||
    (predecessor &&
      (predecessor.reviewId !== review.id ||
        predecessor.recordSourceType !== "synthesis" ||
        predecessor.synthesisOrdinal !== ordinal - 1 ||
        predecessor.synthesisDraftId !== draft.previousAcceptedDraftId ||
        predecessor.synthesisOrdinal !== draft.previousAcceptedOrdinal)) ||
    (!predecessor &&
      (draft.previousAcceptedDraftId !== null || draft.previousAcceptedOrdinal !== null)) ||
    version.synthesisAttributions.length !== 2 ||
    !softwareAttribution ||
    softwareAttribution.position !== 0 ||
    softwareAttribution.kind !== "software-agent" ||
    softwareAttribution.role !== "synthesis-generation" ||
    softwareAttribution.userId !== null ||
    softwareAttribution.userRoleSnapshot !== null ||
    softwareAttribution.githubLoginSnapshot !== null ||
    softwareAttribution.displayName !== version.synthesisPipelineName ||
    softwareAttribution.softwareVersion !== version.synthesisPipelineVersion ||
    !editorAttribution ||
    editorAttribution.position !== 1 ||
    editorAttribution.kind !== "approving-editor" ||
    editorAttribution.role !== "editorial-approval" ||
    editorAttribution.softwareVersion !== null ||
    editorAttribution.userId !== version.synthesisApprovedById ||
    editorAttribution.userId !== draft.acceptedById ||
    editorAttribution.displayName !== version.synthesisApproverDisplayName ||
    editorAttribution.userRoleSnapshot !== version.synthesisApproverRole ||
    editorAttribution.githubLoginSnapshot !== version.synthesisApproverGithubLogin
  )
    return null;

  const candidate = publicSynthesisReviewSchema.safeParse({
    slug: review.slug,
    reviewType: "ai-synthesis",
    title: integrity.document.title,
    abstract: integrity.document.summary,
    document: integrity.document,
    provenance: {
      generationMode: version.synthesisGenerationMode,
      pipelineSoftware: {
        id: version.synthesisPipelineId,
        kind: version.synthesisPipelineKind,
        displayName: version.synthesisPipelineName,
        pipelineVersion: version.synthesisPipelineVersion,
      },
      provider: version.synthesisProvider,
      model: version.synthesisModel,
      modelVersion: version.synthesisModelVersion,
      promptVersion: version.synthesisPromptVersion,
      promptHash: version.synthesisPromptHash,
      packetHash: version.synthesisPacketHash,
      documentHash: version.synthesisDocumentHash,
      generatedAt: version.synthesisGeneratedAt?.toISOString(),
      acceptedAt: version.synthesisAcceptedAt.toISOString(),
      approvingEditor: {
        displayName: version.synthesisApproverDisplayName,
        githubLogin: version.synthesisApproverGithubLogin,
        roleSnapshot: version.synthesisApproverRole,
      },
      attributionPolicyVersion: version.synthesisAttributionPolicyVersion,
      checklistVersion: version.synthesisChecklistVersion,
      materializationPolicyVersion: version.synthesisMaterializationPolicyVersion,
      rightsStatement: version.synthesisRightsStatement,
      licenseSpdx: version.synthesisLicenseSpdx,
      ordinal,
      acceptedPredecessorVersionId: predecessor?.id ?? null,
      acceptedPredecessorOrdinal: predecessor?.synthesisOrdinal ?? null,
    },
    citations: draftCitationDtos(draft).map((citation) => ({
      ...citation,
      href: `/nodes/${citation.nodeId}/versions/${citation.nodeVersionId}`,
    })),
    version: {
      id: version.id,
      ordinal,
      isCurrent: true,
      versionDoi: version.versionDoi ?? undefined,
      conceptDoi: version.conceptDoi ?? undefined,
    },
    freshness: (() => {
      const observation = version.synthesisStalenessHead;
      const unchecked = {
        status: "unchecked" as const,
        policyVersion: SYNTHESIS_STALENESS_POLICY_VERSION,
        reasonCodes: [],
        affectedReferenceCount: 0,
      };
      if (
        !observation ||
        observation.reviewId !== review.id ||
        observation.acceptedReviewVersionId !== version.id ||
        observation.currentEvaluationId !== observation.currentEvaluation.id
      )
        return unchecked;
      const validated = validateStoredSynthesisStaleness(
        observation.currentEvaluation,
        {
          reviewId: review.id,
          acceptedReviewVersionId: version.id,
          acceptedDraftId: draft.id,
          seriesKey: draft.seriesKey,
          selectorJson: draft.selectorJson,
          selectorHash: draft.selectorHash,
          materializationPolicyVersion: draft.materializationPolicyVersion,
          packetJson: draft.packetJson,
          packetHash: draft.packetHash,
        },
        observation.observedAt,
      );
      return validated?.freshness ?? unchecked;
    })(),
  });
  return candidate.success ? candidate.data : null;
}
