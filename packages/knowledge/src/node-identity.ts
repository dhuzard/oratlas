import { createHash } from "node:crypto";
import {
  NODE_IDENTITY_METHOD_VERSION,
  canonicalJson,
  canonicalizeNodeAlias as parseCanonicalNodeAlias,
  canonicalizeDoi,
  canonicalizeOpenAlexId,
  canonicalizePmid,
  nodeIdentityCandidateSchema,
  nodeIdentityProposalReportSchema,
  type NodeAlias,
  type NodeIdentityCandidate,
  type NodeIdentityProposal,
  type NodeIdentityProposalReport,
  type NodeAliasRole,
  type SharedNodeAlias,
} from "@oratlas/contracts";

const DEFAULT_SIMILARITY_THRESHOLD = 0.92;
const NEGATION_TOKENS = new Set(["no", "not", "never", "neither", "without"]);

export interface ProposeNodeIdentitiesOptions {
  /** Conservative lexical threshold after exact normalized-hash comparison. */
  similarityThreshold?: number;
}

export interface NormalizedClaimIdentity {
  statement: string;
  qualifiers: string[];
  canonicalText: string;
  sha256: string;
  tokens: string[];
}

/**
 * Identity normalization deliberately keeps every meaningful token. Search's
 * stop-word filtering is unsafe here because dropping "not", numbers, or a
 * qualifier can collapse scientifically opposing claims.
 */
export function normalizeClaimIdentity(
  statement: string,
  qualifiers: readonly string[] = [],
): NormalizedClaimIdentity {
  const normalizedStatement = identityTokens(statement).join(" ");
  const normalizedQualifiers = qualifiers.map((qualifier) => identityTokens(qualifier).join(" "));
  const canonicalText = canonicalJson({
    qualifiers: normalizedQualifiers,
    statement: normalizedStatement,
  });
  return {
    statement: normalizedStatement,
    qualifiers: normalizedQualifiers,
    canonicalText,
    sha256: sha256(canonicalText),
    tokens: [normalizedStatement, ...normalizedQualifiers].flatMap((value) =>
      value ? value.split(" ") : [],
    ),
  };
}

/** Return one comparison key while retaining scheme and role on the input row. */
export function canonicalNodeAlias(input: unknown): string | undefined {
  const alias = parseCanonicalNodeAlias(input);
  if (!alias || alias.isExample) return undefined;
  const normalized =
    alias.scheme === "doi"
      ? canonicalizeDoi(alias.value)
      : alias.scheme === "pmid"
        ? canonicalizePmid(alias.value)
        : canonicalizeOpenAlexId(alias.value);
  if (!normalized || (alias.scheme === "doi" && normalized.startsWith("10.5555/"))) {
    return undefined;
  }
  return `${alias.scheme}:${normalized}`;
}

/**
 * Produce deterministic, human-reviewable identity proposals. This function
 * is pure: stable node identities are inputs and are never merged or mutated.
 */
export function proposeNodeIdentities(
  input: readonly NodeIdentityCandidate[],
  options: ProposeNodeIdentitiesOptions = {},
): NodeIdentityProposalReport {
  const similarityThreshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  if (similarityThreshold < 0 || similarityThreshold > 1) {
    throw new RangeError("similarityThreshold must be between 0 and 1.");
  }

  const candidates = input.map((candidate) => nodeIdentityCandidateSchema.parse(candidate));
  assertUniqueCandidates(candidates);
  const enriched = candidates
    .map((candidate) => ({
      candidate,
      identityKey: identityKey(candidate),
      aliases: normalizedAliases(candidate.aliases),
      claim: candidate.claim
        ? normalizeClaimIdentity(candidate.claim.statement, candidate.claim.qualifiers)
        : undefined,
    }))
    .sort((left, right) => compareCodeUnits(left.identityKey, right.identityKey));

  const proposals: NodeIdentityProposal[] = [];
  for (let leftIndex = 0; leftIndex < enriched.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < enriched.length; rightIndex += 1) {
      const left = enriched[leftIndex]!;
      const right = enriched[rightIndex]!;
      if (left.candidate.repositoryId === right.candidate.repositoryId) continue;
      if (left.candidate.kind !== right.candidate.kind) continue;

      const sharedAliases = sharedAliasesFor(left.aliases, right.aliases);
      const comparison = compareClaims(left.claim, right.claim, similarityThreshold);
      if (!comparison && sharedAliases.length === 0) continue;

      const kind: NodeIdentityProposal["kind"] = comparison ? "same-claim" : "same-work";
      const signals: NodeIdentityProposal["signals"] = [];
      if (sharedAliases.length > 0) signals.push("shared-identifier");
      if (comparison?.exactHash) signals.push("normalized-text-hash");
      else if (comparison) signals.push("normalized-text-similarity");

      const core = {
        kind,
        methodVersion: NODE_IDENTITY_METHOD_VERSION,
        sharedAliases,
        signals,
        source: endpoint(left.candidate),
        sourceTextHash: comparison ? left.claim?.sha256 : undefined,
        target: endpoint(right.candidate),
        targetTextHash: comparison ? right.claim?.sha256 : undefined,
        textSimilarity: comparison?.similarity,
      };
      proposals.push({ proposalId: `nip_${sha256(canonicalJson(core))}`, ...core });
    }
  }

  proposals.sort((left, right) => compareCodeUnits(left.proposalId, right.proposalId));
  const reportCore = {
    schemaVersion: "1.0.0" as const,
    methodVersion: NODE_IDENTITY_METHOD_VERSION,
    proposals,
  };
  return nodeIdentityProposalReportSchema.parse({
    ...reportCore,
    reportHash: sha256(canonicalJson(reportCore)),
  });
}

function identityTokens(value: string): string[] {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/\bcannot\b/gu, "can not")
    .replace(/\bcan't\b/gu, "can not")
    .replace(/\bwon't\b/gu, "will not")
    .replace(/\bshan't\b/gu, "shall not")
    .replace(/\b(\p{L}+)n't\b/gu, "$1 not")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1");
  return (
    normalized.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:-[\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu) ?? []
  ).map((token) => token.normalize("NFC"));
}

interface NormalizedAlias {
  key: string;
  scheme: NodeAlias["scheme"];
  value: string;
  roles: NodeAliasRole[];
}

function normalizedAliases(aliases: NodeAlias[]): NormalizedAlias[] {
  const byKey = new Map<
    string,
    { scheme: NodeAlias["scheme"]; value: string; roles: Set<NodeAliasRole> }
  >();
  for (const alias of aliases) {
    const key = canonicalNodeAlias(alias);
    if (!key) continue;
    const separator = key.indexOf(":");
    const scheme = key.slice(0, separator) as NodeAlias["scheme"];
    const value = key.slice(separator + 1);
    const existing = byKey.get(key) ?? { scheme, value, roles: new Set<NodeAliasRole>() };
    existing.roles.add(alias.role);
    byKey.set(key, existing);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([key, alias]) => ({
      key,
      scheme: alias.scheme,
      value: alias.value,
      roles: [...alias.roles].sort(compareCodeUnits),
    }));
}

function sharedAliasesFor(left: NormalizedAlias[], right: NormalizedAlias[]): SharedNodeAlias[] {
  const rightByKey = new Map(right.map((alias) => [alias.key, alias]));
  return left.flatMap((alias) => {
    const matching = rightByKey.get(alias.key);
    return matching
      ? [
          {
            scheme: alias.scheme,
            value: alias.value,
            sourceRoles: alias.roles,
            targetRoles: matching.roles,
          },
        ]
      : [];
  });
}

function compareClaims(
  left: NormalizedClaimIdentity | undefined,
  right: NormalizedClaimIdentity | undefined,
  threshold: number,
): { exactHash: boolean; similarity: number } | undefined {
  if (!left || !right) return undefined;
  if (left.sha256 === right.sha256) return { exactHash: true, similarity: 1 };
  if (
    left.qualifiers.length !== right.qualifiers.length ||
    left.qualifiers.some((qualifier, index) => qualifier !== right.qualifiers[index])
  ) {
    return undefined;
  }
  if (differentProtectedTokens(left.tokens, right.tokens)) return undefined;
  const similarity = jaccard(new Set(left.tokens), new Set(right.tokens));
  if (Math.min(left.tokens.length, right.tokens.length) < 3 || similarity < threshold) {
    return undefined;
  }
  return { exactHash: false, similarity: Math.round(similarity * 1_000_000) / 1_000_000 };
}

function differentProtectedTokens(left: readonly string[], right: readonly string[]): boolean {
  const select = (tokens: readonly string[], predicate: (token: string) => boolean) =>
    [...new Set(tokens.filter(predicate))].sort(compareCodeUnits).join("|");
  const leftNegation = select(left, (token) => NEGATION_TOKENS.has(token));
  const rightNegation = select(right, (token) => NEGATION_TOKENS.has(token));
  if (leftNegation !== rightNegation) return true;
  return (
    select(left, (token) => /\p{N}/u.test(token)) !== select(right, (token) => /\p{N}/u.test(token))
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function assertUniqueCandidates(candidates: NodeIdentityCandidate[]): void {
  const nodeIds = new Set<string>();
  const stableKeys = new Set<string>();
  for (const candidate of candidates) {
    if (nodeIds.has(candidate.knowledgeNodeId)) {
      throw new Error(`Duplicate knowledge-node id '${candidate.knowledgeNodeId}'.`);
    }
    const stableKey = identityKey(candidate);
    if (stableKeys.has(stableKey)) {
      throw new Error(`Duplicate stable node identity '${stableKey}'.`);
    }
    nodeIds.add(candidate.knowledgeNodeId);
    stableKeys.add(stableKey);
  }
}

function identityKey(candidate: NodeIdentityCandidate): string {
  return canonicalJson([candidate.repositoryId, candidate.localNodeId]);
}

function endpoint(candidate: NodeIdentityCandidate): NodeIdentityProposal["source"] {
  return {
    knowledgeNodeId: candidate.knowledgeNodeId,
    repositoryId: candidate.repositoryId,
    localNodeId: candidate.localNodeId,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
