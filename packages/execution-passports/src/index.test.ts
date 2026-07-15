import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  EXECUTION_ATTESTATION_PAYLOAD_TYPE,
  globalClaimId,
  PROCESS_RUN_PROFILE,
  RO_CRATE_1_1_CONTEXT,
  RO_CRATE_1_1_PROFILE,
  WORKFLOW_RO_PROFILE,
  WORKFLOW_RUN_CONTEXT,
  WORKFLOW_RUN_PROFILE,
  type ExecutionAttestationStatement,
  type ExecutionPassportRegistration,
  type WorkflowRunCrate,
} from "@oratlas/contracts";
import {
  dssePae,
  executionKeyId,
  ExecutionPassportVerificationError,
  verifyExecutionPassport,
  type TrustedExecutionKey,
} from "./index.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const commitSha = "1".repeat(40);
const treeSha = "2".repeat(40);
const workflowSha = digest("workflow");
const inputSha = digest("input");
const outputSha = digest("output");
const claim = {
  versionId: "version-1",
  localClaimId: "claim-1",
  claimId: globalClaimId("version-1", "claim-1"),
};

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyId = executionKeyId(publicKey);
  const trustedKey: TrustedExecutionKey = {
    keyId,
    algorithm: "ed25519",
    publicKeyPem,
    issuer: "https://token.actions.githubusercontent.com",
    subject: "https://github.com/example/review/.github/workflows/analysis.yml@refs/heads/main",
  };
  const crate: WorkflowRunCrate = {
    "@context": [RO_CRATE_1_1_CONTEXT, WORKFLOW_RUN_CONTEXT],
    "@graph": [
      {
        "@id": "ro-crate-metadata.json",
        "@type": "CreativeWork",
        about: { "@id": "./" },
        conformsTo: [{ "@id": RO_CRATE_1_1_PROFILE }, { "@id": WORKFLOW_RO_PROFILE }],
      },
      {
        "@id": "./",
        "@type": "Dataset",
        name: "Attested analysis run",
        conformsTo: [
          { "@id": WORKFLOW_RUN_PROFILE },
          { "@id": PROCESS_RUN_PROFILE },
          { "@id": WORKFLOW_RO_PROFILE },
        ],
        license: "MIT",
        mainEntity: { "@id": ".github/workflows/analysis.yml" },
        mentions: [{ "@id": "#source" }, { "@id": "#run" }, { "@id": "#claim-1" }],
        hasPart: [
          { "@id": ".github/workflows/analysis.yml" },
          { "@id": "inputs/data.csv" },
          { "@id": "outputs/result.json" },
        ],
      },
      {
        "@id": WORKFLOW_RUN_PROFILE,
        "@type": "CreativeWork",
        name: "Workflow Run RO-Crate 0.5",
      },
      {
        "@id": PROCESS_RUN_PROFILE,
        "@type": "CreativeWork",
        name: "Process Run RO-Crate 0.5",
      },
      {
        "@id": WORKFLOW_RO_PROFILE,
        "@type": "CreativeWork",
        name: "Workflow RO-Crate 1.0",
      },
      {
        "@id": "#github-actions",
        "@type": "ComputerLanguage",
        name: "GitHub Actions workflow",
      },
      {
        "@id": "#source",
        "@type": "SoftwareSourceCode",
        codeRepository: "https://github.com/example/review",
        commitSha,
        treeSha,
      },
      {
        "@id": ".github/workflows/analysis.yml",
        "@type": ["File", "SoftwareSourceCode", "ComputationalWorkflow"],
        name: "analysis.yml",
        programmingLanguage: { "@id": "#github-actions" },
        workflowPath: ".github/workflows/analysis.yml",
        sha256: workflowSha,
      },
      {
        "@id": "#run",
        "@type": "CreateAction",
        name: "GitHub Actions run 42",
        actionStatus: "https://schema.org/CompletedActionStatus",
        instrument: { "@id": ".github/workflows/analysis.yml" },
        object: { "@id": "inputs/data.csv" },
        result: { "@id": "outputs/result.json" },
        claimBindings: { "@id": "#claim-1" },
        runId: "42",
        runAttempt: 1,
      },
      {
        "@id": "inputs/data.csv",
        "@type": "File",
        name: "data.csv",
        sha256: inputSha,
        contentSize: 5,
        encodingFormat: "text/csv",
      },
      {
        "@id": "outputs/result.json",
        "@type": "File",
        name: "result.json",
        sha256: outputSha,
        contentSize: 6,
        encodingFormat: "application/json",
      },
      {
        "@id": "#claim-1",
        "@type": "EvidenceBinding",
        name: "Immutable Atlas claim binding",
        oratlasClaimId: claim.claimId,
      },
    ],
  };

  const statement: ExecutionAttestationStatement = {
    schemaVersion: "1.0",
    predicateType: "https://oratlas.org/attestations/execution/v1",
    crateSha256: digest(canonicalJson(crate)),
    repository: {
      url: "https://github.com/example/review",
      commitSha,
      treeSha,
    },
    workflow: {
      entityId: ".github/workflows/analysis.yml",
      path: ".github/workflows/analysis.yml",
      sha256: workflowSha,
      runId: "42",
      runAttempt: 1,
    },
    claims: [claim],
    artifacts: [
      {
        entityId: "inputs/data.csv",
        role: "input",
        name: "data.csv",
        path: "inputs/data.csv",
        mediaType: "text/csv",
        byteSize: 5,
        sha256: inputSha,
      },
      {
        entityId: "outputs/result.json",
        role: "output",
        name: "result.json",
        path: "outputs/result.json",
        mediaType: "application/json",
        byteSize: 6,
        sha256: outputSha,
      },
    ],
    signingIdentity: { issuer: trustedKey.issuer, subject: trustedKey.subject },
    issuedAt: "2026-07-15T08:00:00.000Z",
  };

  const packageFor = (
    nextCrate: WorkflowRunCrate = crate,
    nextStatement: ExecutionAttestationStatement = statement,
  ): ExecutionPassportRegistration => {
    const payload = Buffer.from(canonicalJson(nextStatement));
    return {
      crate: nextCrate,
      attestation: {
        payloadType: EXECUTION_ATTESTATION_PAYLOAD_TYPE,
        payload: payload.toString("base64"),
        signatures: [
          {
            keyId,
            sig: sign(
              null,
              dssePae(EXECUTION_ATTESTATION_PAYLOAD_TYPE, payload),
              privateKey,
            ).toString("base64"),
          },
        ],
      },
    };
  };
  return { crate, statement, trustedKey, packageFor };
}

describe("execution passport verification", () => {
  it("verifies the exact crate, artifacts, claims and configured signing identity offline", () => {
    const { packageFor, trustedKey } = fixture();
    const result = verifyExecutionPassport(
      packageFor(),
      [trustedKey],
      new Date("2026-07-15T09:00:00.000Z"),
    );
    expect(result.status).toBe("execution-attested");
    expect(result.checks).toEqual({
      structure: "verified",
      artifactDigests: "verified",
      signature: "verified",
      signingIdentity: "verified",
    });
    expect(result.claims).toEqual([claim]);
    expect(result.artifacts.map((artifact) => artifact.role)).toEqual(["input", "output"]);
  });

  it("fails closed when the crate digest is changed", () => {
    const { crate, packageFor, statement, trustedKey } = fixture();
    const changed = structuredClone(crate);
    changed["@graph"].find((entity) => entity["@id"] === "outputs/result.json")!.sha256 =
      digest("tampered");
    expect(() =>
      verifyExecutionPassport(packageFor(changed, statement), [trustedKey]),
    ).toThrowError(expect.objectContaining({ code: "digest-mismatch" }));
  });

  it("fails closed when artifact digests disagree between crate and attestation", () => {
    const { packageFor, statement, trustedKey } = fixture();
    const changed = structuredClone(statement);
    changed.artifacts[1]!.sha256 = digest("other output");
    expect(() =>
      verifyExecutionPassport(packageFor(undefined, changed), [trustedKey]),
    ).toThrowError(expect.objectContaining({ code: "digest-mismatch" }));
  });

  it("rejects mutable branch/ref assertions anywhere in the crate", () => {
    const { crate, packageFor, statement, trustedKey } = fixture();
    const changed = structuredClone(crate) as WorkflowRunCrate & { branch?: string };
    changed["@graph"].find((entity) => entity["@id"] === "#source")!.branch = "main";
    const nextStatement = { ...statement, crateSha256: digest(canonicalJson(changed)) };
    expect(() =>
      verifyExecutionPassport(packageFor(changed, nextStatement), [trustedKey]),
    ).toThrowError(expect.objectContaining({ code: "mutable-reference" }));
  });

  it("requires the exact RO-Crate and Workflow Run contexts and profiles", () => {
    const { crate, packageFor, statement, trustedKey } = fixture();
    const missingContext = structuredClone(crate);
    missingContext["@context"] = [RO_CRATE_1_1_CONTEXT];
    const contextStatement = {
      ...statement,
      crateSha256: digest(canonicalJson(missingContext)),
    };
    expect(() =>
      verifyExecutionPassport(packageFor(missingContext, contextStatement), [trustedKey]),
    ).toThrowError(expect.objectContaining({ code: "malformed-crate" }));

    const missingProfile = structuredClone(crate);
    delete missingProfile["@graph"].find((entity) => entity["@id"] === "./")!.conformsTo;
    const profileStatement = {
      ...statement,
      crateSha256: digest(canonicalJson(missingProfile)),
    };
    expect(() =>
      verifyExecutionPassport(packageFor(missingProfile, profileStatement), [trustedKey]),
    ).toThrowError(expect.objectContaining({ code: "malformed-crate" }));

    const missingMainEntity = structuredClone(crate);
    delete missingMainEntity["@graph"].find((entity) => entity["@id"] === "./")!.mainEntity;
    const mainEntityStatement = {
      ...statement,
      crateSha256: digest(canonicalJson(missingMainEntity)),
    };
    expect(() =>
      verifyExecutionPassport(packageFor(missingMainEntity, mainEntityStatement), [trustedKey]),
    ).toThrowError(expect.objectContaining({ code: "malformed-crate" }));
  });

  it("rejects optional workflow parameter fields outside the validated profile subset", () => {
    const { crate, packageFor, statement, trustedKey } = fixture();
    const changed = structuredClone(crate) as WorkflowRunCrate;
    const workflow = changed["@graph"].find(
      (entity) => entity["@id"] === ".github/workflows/analysis.yml",
    )! as (typeof changed)["@graph"][number] & { input?: unknown };
    workflow.input = "not-an-entity-reference";
    const nextStatement = { ...statement, crateSha256: digest(canonicalJson(changed)) };
    expect(() =>
      verifyExecutionPassport(packageFor(changed, nextStatement), [trustedKey]),
    ).toThrowError(expect.objectContaining({ code: "malformed-crate" }));

    const iriChanged = structuredClone(crate) as WorkflowRunCrate;
    const iriWorkflow = iriChanged["@graph"].find(
      (entity) => entity["@id"] === ".github/workflows/analysis.yml",
    )!;
    iriWorkflow["https://bioschemas.org/ComputationalWorkflow#input"] = "not-an-entity-reference";
    const iriStatement = { ...statement, crateSha256: digest(canonicalJson(iriChanged)) };
    expect(() =>
      verifyExecutionPassport(packageFor(iriChanged, iriStatement), [trustedKey]),
    ).toThrowError(expect.objectContaining({ code: "malformed-crate" }));

    const aliasChanged = structuredClone(crate) as unknown as WorkflowRunCrate;
    (aliasChanged as unknown as { "@context": unknown[] })["@context"].push({
      parameter: "https://bioschemas.org/ComputationalWorkflow#input",
    });
    const aliasStatement = { ...statement, crateSha256: digest(canonicalJson(aliasChanged)) };
    expect(() =>
      verifyExecutionPassport(packageFor(aliasChanged, aliasStatement), [trustedKey]),
    ).toThrowError(expect.objectContaining({ code: "malformed-crate" }));
  });

  it("canonicalizes equivalent issuedAt instants", () => {
    const { packageFor, statement, trustedKey } = fixture();
    const changed = { ...statement, issuedAt: "2026-07-15T08:00:00Z" };
    expect(
      verifyExecutionPassport(
        packageFor(undefined, changed),
        [trustedKey],
        new Date("2026-07-15T09:00:00.000Z"),
      ).issuedAt,
    ).toBe("2026-07-15T08:00:00.000Z");
  });

  it("rejects an unknown signing identity even when its signature is well formed", () => {
    const { packageFor } = fixture();
    expect(() => verifyExecutionPassport(packageFor(), [])).toThrowError(
      expect.objectContaining({ code: "identity-unverifiable" }),
    );
  });

  it("rejects a corrupted signature from a configured identity", () => {
    const { packageFor, trustedKey } = fixture();
    const changed = packageFor();
    const signature = changed.attestation.signatures[0]!.sig;
    changed.attestation.signatures[0]!.sig = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    expect(() => verifyExecutionPassport(changed, [trustedKey])).toThrowError(
      expect.objectContaining({ code: "signature-invalid" }),
    );
  });

  it("rejects a claim id that is not the immutable version/local claim id", () => {
    const { packageFor, statement, trustedKey } = fixture();
    const changed = structuredClone(statement);
    changed.claims[0]!.claimId = "claim-1";
    expect(() => verifyExecutionPassport(packageFor(undefined, changed), [trustedKey])).toThrow(
      ExecutionPassportVerificationError,
    );
  });
});
