import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";
import {
  canonicalJson,
  dsseEnvelopeSchema,
  EXECUTION_ATTESTATION_PAYLOAD_TYPE,
  EXECUTION_ATTESTED_STATUS,
  executionAttestationStatementSchema,
  executionPassportRegistrationSchema,
  globalClaimId,
  PROCESS_RUN_PROFILE,
  RO_CRATE_1_1_PROFILE,
  WORKFLOW_RO_PROFILE,
  WORKFLOW_RUN_PROFILE,
  type ExecutionArtifactDescriptor,
  type ExecutionAttestationStatement,
  type ExecutionClaimBinding,
  type ExecutionPassportRegistration,
  type WorkflowRunCrate,
} from "@oratlas/contracts";
import { z } from "zod";

const trustedExecutionKeySchema = z
  .object({
    keyId: z.string().regex(/^[0-9a-f]{64}$/),
    algorithm: z.literal("ed25519"),
    publicKeyPem: z.string().min(80).max(10_000),
    issuer: z.string().trim().min(1).max(500),
    subject: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type TrustedExecutionKey = z.infer<typeof trustedExecutionKeySchema>;

const trustedExecutionKeysSchema = z.array(trustedExecutionKeySchema).max(64);

export type ExecutionPassportVerificationCode =
  | "malformed-crate"
  | "malformed-attestation"
  | "digest-mismatch"
  | "mutable-reference"
  | "identity-unverifiable"
  | "signature-invalid"
  | "binding-mismatch";

export class ExecutionPassportVerificationError extends Error {
  constructor(
    message: string,
    public readonly code: ExecutionPassportVerificationCode,
  ) {
    super(message);
    this.name = "ExecutionPassportVerificationError";
  }
}

export interface VerifiedExecutionPassport {
  status: typeof EXECUTION_ATTESTED_STATUS;
  crateSha256: string;
  attestationSha256: string;
  payloadSha256: string;
  repository: ExecutionAttestationStatement["repository"];
  workflow: ExecutionAttestationStatement["workflow"];
  claims: ExecutionClaimBinding[];
  artifacts: ExecutionArtifactDescriptor[];
  signingIdentity: ExecutionAttestationStatement["signingIdentity"] & { keyId: string };
  issuedAt: string;
  checks: {
    structure: "verified";
    artifactDigests: "verified";
    signature: "verified";
    signingIdentity: "verified";
  };
}

type CrateEntity = WorkflowRunCrate["@graph"][number];

function sha256Bytes(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function typeList(entity: CrateEntity): string[] {
  return Array.isArray(entity["@type"]) ? entity["@type"] : [entity["@type"]];
}

function hasType(entity: CrateEntity, type: string): boolean {
  return typeList(entity).includes(type);
}

function references(value: unknown): string[] {
  if (!value) return [];
  const rows = Array.isArray(value) ? value : [value];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object" || !("@id" in row)) return [];
    return typeof row["@id"] === "string" ? [row["@id"]] : [];
  });
}

function exactlyOne(
  entities: CrateEntity[],
  predicate: (entity: CrateEntity) => boolean,
  label: string,
) {
  const found = entities.filter(predicate);
  if (found.length !== 1) {
    throw new ExecutionPassportVerificationError(
      `Workflow Run crate must contain exactly one ${label}.`,
      "malformed-crate",
    );
  }
  return found[0]!;
}

const MUTABLE_KEYS = new Set([
  "branch",
  "branchname",
  "tag",
  "tagname",
  "ref",
  "gitref",
  "headref",
  "defaultbranch",
]);

const SUPPORTED_ENTITY_KEYS = new Set([
  "@id",
  "@type",
  "name",
  "about",
  "conformsTo",
  "hasPart",
  "mainEntity",
  "mentions",
  "programmingLanguage",
  "license",
  "instrument",
  "object",
  "result",
  "claimBindings",
  "actionStatus",
  "codeRepository",
  "commitSha",
  "treeSha",
  "workflowPath",
  "runId",
  "runAttempt",
  "sha256",
  "contentSize",
  "encodingFormat",
  "oratlasClaimId",
]);

function rejectUnknownEntityProperties(graph: CrateEntity[]): void {
  for (const entity of graph) {
    for (const key of Object.keys(entity)) {
      if (!SUPPORTED_ENTITY_KEYS.has(key)) {
        throw new ExecutionPassportVerificationError(
          `Entity property '${key}' is outside the supported bounded profile subset.`,
          "malformed-crate",
        );
      }
    }
  }
}

function rejectMutableReferences(value: unknown, path = "$", seen = new Set<object>()): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) {
    throw new ExecutionPassportVerificationError(`Circular value at ${path}.`, "malformed-crate");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => rejectMutableReferences(entry, `${path}[${index}]`, seen));
      return;
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (MUTABLE_KEYS.has(key.replace(/[^a-z]/gi, "").toLowerCase())) {
        throw new ExecutionPassportVerificationError(
          `Mutable source selector ${path}.${key} is not accepted.`,
          "mutable-reference",
        );
      }
      rejectMutableReferences(entry, `${path}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function assertExactSet(actual: string[], expected: string[], label: string): void {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  if (canonicalJson(left) !== canonicalJson(right)) {
    throw new ExecutionPassportVerificationError(
      `${label} do not match the signed statement.`,
      "binding-mismatch",
    );
  }
}

function verifyCrateProfile(
  crate: WorkflowRunCrate,
  statement: ExecutionAttestationStatement,
): void {
  rejectMutableReferences(crate);
  const graph = crate["@graph"];
  rejectUnknownEntityProperties(graph);
  const byId = new Map(graph.map((entity) => [entity["@id"], entity]));
  const metadata = exactlyOne(
    graph,
    (entity) => entity["@id"] === "ro-crate-metadata.json" && hasType(entity, "CreativeWork"),
    "ro-crate-metadata.json CreativeWork",
  );
  if (metadata.about?.["@id"] !== "./") {
    throw new ExecutionPassportVerificationError(
      "Crate metadata must describe the ./ root dataset.",
      "malformed-crate",
    );
  }
  const root = exactlyOne(
    graph,
    (entity) => entity["@id"] === "./" && hasType(entity, "Dataset"),
    "./ Dataset",
  );
  const repository = exactlyOne(
    graph,
    (entity) =>
      hasType(entity, "SoftwareSourceCode") &&
      entity.codeRepository !== undefined &&
      entity.commitSha !== undefined &&
      entity.treeSha !== undefined,
    "immutable repository source-code entity",
  );
  const workflow = exactlyOne(
    graph,
    (entity) =>
      hasType(entity, "ComputationalWorkflow") &&
      hasType(entity, "SoftwareSourceCode") &&
      hasType(entity, "File"),
    "File/SoftwareSourceCode/ComputationalWorkflow entity",
  );
  const run = exactlyOne(graph, (entity) => hasType(entity, "CreateAction"), "CreateAction run");

  if (
    !references(metadata.conformsTo).includes(RO_CRATE_1_1_PROFILE) ||
    !references(metadata.conformsTo).includes(WORKFLOW_RO_PROFILE)
  ) {
    throw new ExecutionPassportVerificationError(
      "Crate metadata must declare RO-Crate 1.1 and Workflow RO-Crate 1.0 conformance.",
      "malformed-crate",
    );
  }
  if (
    !references(root.conformsTo).includes(WORKFLOW_RUN_PROFILE) ||
    !references(root.conformsTo).includes(PROCESS_RUN_PROFILE) ||
    !references(root.conformsTo).includes(WORKFLOW_RO_PROFILE)
  ) {
    throw new ExecutionPassportVerificationError(
      "Root dataset must declare Workflow Run 0.5, Process Run 0.5, and Workflow RO-Crate 1.0 profiles.",
      "malformed-crate",
    );
  }
  for (const profile of [WORKFLOW_RUN_PROFILE, PROCESS_RUN_PROFILE, WORKFLOW_RO_PROFILE]) {
    const entity = byId.get(profile);
    if (!entity || !hasType(entity, "CreativeWork")) {
      throw new ExecutionPassportVerificationError(
        `Crate profile ${profile} must resolve to a CreativeWork entity.`,
        "malformed-crate",
      );
    }
  }
  if (
    root.mainEntity?.["@id"] !== workflow["@id"] ||
    !references(root.mentions).includes(run["@id"]) ||
    root.license === undefined
  ) {
    throw new ExecutionPassportVerificationError(
      "Root dataset must license the crate, identify the main workflow, and mention the run.",
      "malformed-crate",
    );
  }
  const languageId = workflow.programmingLanguage?.["@id"];
  const language = languageId ? byId.get(languageId) : undefined;
  if (!language || !hasType(language, "ComputerLanguage")) {
    throw new ExecutionPassportVerificationError(
      "Main workflow must reference a declared ComputerLanguage.",
      "malformed-crate",
    );
  }

  const repositoryUrl = new URL(statement.repository.url);
  if (
    repositoryUrl.search ||
    repositoryUrl.hash ||
    /\/(?:tree|blob)\//i.test(repositoryUrl.pathname)
  ) {
    throw new ExecutionPassportVerificationError(
      "Repository identity must be a base URL without a mutable ref selector.",
      "mutable-reference",
    );
  }

  if (run.actionStatus !== "https://schema.org/CompletedActionStatus") {
    throw new ExecutionPassportVerificationError(
      "Only completed workflow runs may be attested.",
      "malformed-crate",
    );
  }
  if (
    repository.codeRepository !== statement.repository.url ||
    repository.commitSha !== statement.repository.commitSha ||
    repository.treeSha !== statement.repository.treeSha
  ) {
    throw new ExecutionPassportVerificationError(
      "Repository commit/tree do not match the signed statement.",
      "binding-mismatch",
    );
  }
  if (
    workflow["@id"] !== statement.workflow.entityId ||
    workflow.workflowPath !== statement.workflow.path ||
    workflow.sha256 !== statement.workflow.sha256 ||
    run.instrument?.["@id"] !== workflow["@id"] ||
    run.runId !== statement.workflow.runId ||
    run.runAttempt !== statement.workflow.runAttempt
  ) {
    throw new ExecutionPassportVerificationError(
      "Workflow identity does not match the signed statement.",
      "binding-mismatch",
    );
  }

  const inputArtifacts = statement.artifacts.filter((artifact) => artifact.role === "input");
  const outputArtifacts = statement.artifacts.filter((artifact) => artifact.role === "output");
  if (inputArtifacts.length === 0 || outputArtifacts.length === 0) {
    throw new ExecutionPassportVerificationError(
      "At least one exact input and output are required.",
      "malformed-crate",
    );
  }
  const artifactIds = statement.artifacts.map((artifact) => artifact.entityId);
  if (new Set(artifactIds).size !== artifactIds.length) {
    throw new ExecutionPassportVerificationError(
      "Artifact entity ids must be unique.",
      "malformed-attestation",
    );
  }
  assertExactSet(
    references(run.object),
    inputArtifacts.map((artifact) => artifact.entityId),
    "Run inputs",
  );
  assertExactSet(
    references(run.result),
    outputArtifacts.map((artifact) => artifact.entityId),
    "Run outputs",
  );
  for (const artifact of statement.artifacts) {
    const entity = byId.get(artifact.entityId);
    if (
      !entity ||
      !hasType(entity, "File") ||
      entity.sha256 !== artifact.sha256 ||
      entity.contentSize !== artifact.byteSize ||
      entity.name !== artifact.name ||
      artifact.path !== entity["@id"] ||
      (artifact.mediaType ?? undefined) !== (entity.encodingFormat ?? undefined)
    ) {
      throw new ExecutionPassportVerificationError(
        `Artifact ${artifact.entityId} metadata or SHA-256 digest does not match the crate.`,
        "digest-mismatch",
      );
    }
  }

  const claimIds = statement.claims.map((claim) => claim.claimId);
  if (new Set(claimIds).size !== claimIds.length) {
    throw new ExecutionPassportVerificationError(
      "Claim bindings must be unique.",
      "malformed-attestation",
    );
  }
  for (const claim of statement.claims) {
    if (claim.claimId !== globalClaimId(claim.versionId, claim.localClaimId)) {
      throw new ExecutionPassportVerificationError(
        "A claim id is not the immutable Atlas id for its version/local id.",
        "binding-mismatch",
      );
    }
  }
  const bindingRefs = references(run.claimBindings);
  const boundClaimIds = bindingRefs.map((id) => {
    const entity = byId.get(id);
    if (!entity || !hasType(entity, "EvidenceBinding") || !entity.oratlasClaimId) {
      throw new ExecutionPassportVerificationError(
        `Invalid claim binding entity ${id}.`,
        "malformed-crate",
      );
    }
    return entity.oratlasClaimId;
  });
  assertExactSet(boundClaimIds, claimIds, "Claim bindings");

  const dataParts = [workflow["@id"], ...artifactIds];
  const contextualMentions = [repository["@id"], run["@id"], ...bindingRefs];
  assertExactSet(references(root.hasPart), dataParts, "Root hasPart data references");
  assertExactSet(references(root.mentions), contextualMentions, "Root contextual mentions");
  for (const id of [...dataParts, ...contextualMentions]) {
    if (!byId.has(id)) {
      throw new ExecutionPassportVerificationError(
        `Crate reference ${id} is unresolved.`,
        "malformed-crate",
      );
    }
  }
}

function decodeCanonicalPayload(payload: string): {
  bytes: Buffer;
  statement: ExecutionAttestationStatement;
} {
  const bytes = Buffer.from(payload, "base64");
  if (bytes.toString("base64") !== payload) {
    throw new ExecutionPassportVerificationError(
      "Attestation payload is not canonical base64.",
      "malformed-attestation",
    );
  }
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ExecutionPassportVerificationError(
      "Attestation payload is not valid UTF-8.",
      "malformed-attestation",
    );
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new ExecutionPassportVerificationError(
      "Attestation payload is not JSON.",
      "malformed-attestation",
    );
  }
  const parsed = executionAttestationStatementSchema.safeParse(input);
  if (!parsed.success || canonicalJson(parsed.success ? parsed.data : input) !== raw) {
    throw new ExecutionPassportVerificationError(
      "Attestation statement is invalid or not canonical JSON.",
      "malformed-attestation",
    );
  }
  return { bytes, statement: parsed.data };
}

/** DSSE pre-authentication encoding: exact bytes required by the DSSE v1 specification. */
export function dssePae(payloadType: string, payload: Uint8Array): Buffer {
  const typeBytes = Buffer.from(payloadType, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${typeBytes.byteLength} `, "ascii"),
    typeBytes,
    Buffer.from(` ${payload.byteLength} `, "ascii"),
    payload,
  ]);
}

export function executionKeyId(publicKey: KeyObject | string): string {
  const key = typeof publicKey === "string" ? createPublicKey(publicKey) : publicKey;
  return sha256Bytes(key.export({ type: "spki", format: "der" }));
}

export function parseTrustedExecutionKeys(raw: string | undefined): TrustedExecutionKey[] {
  if (!raw?.trim()) return [];
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error("EXECUTION_PASSPORT_TRUSTED_KEYS_JSON must be valid JSON.");
  }
  const keys = trustedExecutionKeysSchema.parse(input);
  const ids = new Set<string>();
  for (const key of keys) {
    let parsed: KeyObject;
    try {
      parsed = createPublicKey(key.publicKeyPem);
    } catch {
      throw new Error(`Execution passport trusted key ${key.keyId} is not a valid public key.`);
    }
    if (parsed.asymmetricKeyType !== "ed25519" || executionKeyId(parsed) !== key.keyId) {
      throw new Error(
        `Execution passport trusted key ${key.keyId} has the wrong type or fingerprint.`,
      );
    }
    if (ids.has(key.keyId))
      throw new Error(`Duplicate execution passport trusted key ${key.keyId}.`);
    ids.add(key.keyId);
  }
  return keys;
}

/**
 * Verify one package entirely offline. No repository is cloned, no submitted
 * code is evaluated, and no network resolver is consulted.
 */
export function verifyExecutionPassport(
  input: ExecutionPassportRegistration,
  trustedKeys: TrustedExecutionKey[],
  now = new Date(),
): VerifiedExecutionPassport {
  const registration = executionPassportRegistrationSchema.safeParse(input);
  if (!registration.success) {
    throw new ExecutionPassportVerificationError(
      "Execution passport package is malformed.",
      "malformed-crate",
    );
  }
  const envelope = dsseEnvelopeSchema.parse(registration.data.attestation);
  const { bytes, statement } = decodeCanonicalPayload(envelope.payload);
  const issuedAt = new Date(statement.issuedAt);
  if (issuedAt.getTime() > now.getTime() + 5 * 60_000) {
    throw new ExecutionPassportVerificationError(
      "Attestation issue time is in the future.",
      "malformed-attestation",
    );
  }
  const crateSha256 = sha256Bytes(canonicalJson(registration.data.crate));
  if (crateSha256 !== statement.crateSha256) {
    throw new ExecutionPassportVerificationError(
      "Crate SHA-256 does not match the signed statement.",
      "digest-mismatch",
    );
  }
  verifyCrateProfile(registration.data.crate, statement);

  const trustedById = new Map(trustedKeys.map((key) => [key.keyId, key]));
  let verifiedKey: TrustedExecutionKey | undefined;
  for (const signature of envelope.signatures) {
    const trusted = trustedById.get(signature.keyId);
    if (!trusted) continue;
    if (
      trusted.issuer !== statement.signingIdentity.issuer ||
      trusted.subject !== statement.signingIdentity.subject
    ) {
      continue;
    }
    const signatureBytes = Buffer.from(signature.sig, "base64");
    if (signatureBytes.toString("base64") !== signature.sig) continue;
    if (
      verifySignature(
        null,
        dssePae(EXECUTION_ATTESTATION_PAYLOAD_TYPE, bytes),
        trusted.publicKeyPem,
        signatureBytes,
      )
    ) {
      verifiedKey = trusted;
      break;
    }
  }
  if (!verifiedKey) {
    const hasKnownKey = envelope.signatures.some((signature) => trustedById.has(signature.keyId));
    throw new ExecutionPassportVerificationError(
      hasKnownKey
        ? "Attestation signature or signing identity is invalid."
        : "Attestation signing key is not explicitly trusted.",
      hasKnownKey ? "signature-invalid" : "identity-unverifiable",
    );
  }

  return {
    status: EXECUTION_ATTESTED_STATUS,
    crateSha256,
    attestationSha256: sha256Bytes(canonicalJson(envelope)),
    payloadSha256: sha256Bytes(bytes),
    repository: statement.repository,
    workflow: statement.workflow,
    claims: statement.claims,
    artifacts: statement.artifacts,
    signingIdentity: { ...statement.signingIdentity, keyId: verifiedKey.keyId },
    issuedAt: issuedAt.toISOString(),
    checks: {
      structure: "verified",
      artifactDigests: "verified",
      signature: "verified",
      signingIdentity: "verified",
    },
  };
}
