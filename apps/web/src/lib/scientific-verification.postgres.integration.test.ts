import { createHash } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@oratlas/contracts";

vi.mock("server-only", () => ({}));
import { prisma } from "./db";
import {
  claimVerificationRun,
  completeVerificationArtifact,
  createVerificationProtocol,
  createVerificationRun,
  createVerifier,
  prepareVerificationArtifact,
  submitVerificationFinding,
  transitionVerificationRun,
  uploadVerificationArtifact,
  type VerifierAuth,
} from "./scientific-verification";

const enabled = Boolean(process.env.SCIENTIFIC_VERIFICATION_TEST_DATABASE_URL);
const suffix = `${Date.now()}-${process.pid}`;
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const leasedRequest = (lease: string) =>
  new Request("https://atlas.example/api/verification-runs", {
    headers: { "x-oratlas-verification-lease": lease },
  });

describe.skipIf(!enabled)("scientific verification races on PostgreSQL", () => {
  afterAll(async () => prisma.$disconnect());

  it("fails closed across claim, reclaim, finding, artifact, and terminal races", async () => {
    const admin = await prisma.user.create({
      data: { githubLogin: `verification-admin-${suffix}`, role: "ADMIN" },
    });
    const publication = await prisma.publication.create({
      data: {
        stableKey: `verification-publication-${suffix}`,
        publicationType: "research-article",
        recordSource: "external-publication",
        identityEvidenceJson: canonicalJson({ basis: "registration", registrationKey: suffix }),
      },
    });
    const version = await prisma.publicationVersion.create({
      data: {
        publicationId: publication.id,
        stableKey: `verification-version-${suffix}`,
        sourcesSha256: sha(`sources-${suffix}`),
        observedPublicationBaseUrl: "https://verification.example/article/",
        adapterType: "myst",
        adapterBindingJson: canonicalJson({ type: "myst", protocolVersion: "0.2.0" }),
        structuralProvenance: "published-structure",
        observedAt: new Date("2026-08-25T00:00:00.000Z"),
      },
    });
    const verifierA = await createVerifier(
      { slug: `race-a-${suffix}`, name: "Race A", description: "PostgreSQL race fixture A." },
      admin.id,
    );
    const verifierB = await createVerifier(
      { slug: `race-b-${suffix}`, name: "Race B", description: "PostgreSQL race fixture B." },
      admin.id,
    );
    const protocol = await createVerificationProtocol(
      {
        authorityVerifierId: verifierA.id,
        seriesKey: "generic-race",
        protocolVersion: "1.0.0",
        title: "Generic race protocol",
        description: "External concurrency fixture.",
        verificationType: "generic-race",
        executionMode: "external-execution",
        supportedSubjectTypes: ["publication-version"],
        definition: { externalExecutionRequired: true },
      },
      admin.id,
    );
    const authA: VerifierAuth = {
      verifierId: verifierA.id,
      credentialId: `credential-a-${suffix}`,
    };
    const authB: VerifierAuth = {
      verifierId: verifierB.id,
      credentialId: `credential-b-${suffix}`,
    };
    const makeRun = (key: string) =>
      createVerificationRun(
        {
          verificationProtocolId: protocol.id,
          subject: { type: "publication-version", publicationVersionId: version.id },
          inputProfile: "full",
          inputProfileVersion: "1.0.0",
          idempotencyKey: `${key}-${suffix}`,
        },
        admin.id,
      );

    const run = await makeRun("claim-race");
    const claims = await Promise.allSettled([
      claimVerificationRun(run.id, authA, 300),
      claimVerificationRun(run.id, authB, 300),
    ]);
    expect(claims.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const winner = claims.find((result) => result.status === "fulfilled")!;
    if (winner.status !== "fulfilled") throw new Error("No claim winner.");
    const winnerAuth = winner.value.claimedVerifierId === verifierA.id ? authA : authB;
    const request = leasedRequest(winner.value.leaseToken);

    const bytes = new TextEncoder().encode(canonicalJson({ result: "exact" }));
    const prepared = await prepareVerificationArtifact(
      run.id,
      {
        artifactKey: "race-artifact",
        kind: "comparison-report",
        mediaType: "application/json",
        sha256: sha(bytes),
        byteLength: bytes.byteLength,
        visibility: "public",
      },
      winnerAuth,
      request,
    );
    await uploadVerificationArtifact(
      prepared.artifactId,
      bytes,
      "application/json",
      winnerAuth,
      request,
    );
    const completions = await Promise.all([
      completeVerificationArtifact(run.id, prepared.artifactId, winnerAuth, request),
      completeVerificationArtifact(run.id, prepared.artifactId, winnerAuth, request),
    ]);
    expect(new Set(completions.map((item) => item.id))).toEqual(new Set([prepared.artifactId]));
    expect(
      await prisma.verificationArtifactBlob.count({ where: { artifactId: prepared.artifactId } }),
    ).toBe(1);
    await transitionVerificationRun(
      run.id,
      { status: "running" },
      { verifier: winnerAuth, request },
    );

    const finding = {
      findingKey: "duplicate-finding",
      findingType: "analysis-result-comparison",
      status: "verified" as const,
      impact: "major" as const,
      statement: "External result matched.",
      rationale: "Exact same-run artifact supported the result.",
      evidenceRefs: [{ type: "verification-artifact" as const, id: prepared.artifactId }],
      artifactRefs: [prepared.artifactId],
    };
    const duplicate = await Promise.all([
      submitVerificationFinding(run.id, finding, winnerAuth, request),
      submitVerificationFinding(run.id, finding, winnerAuth, request),
    ]);
    expect(new Set(duplicate.map((item) => item.id)).size).toBe(1);
    expect(
      await prisma.verificationFinding.count({
        where: { verificationRunId: run.id, findingKey: finding.findingKey },
      }),
    ).toBe(1);

    const conflicting = await Promise.allSettled([
      submitVerificationFinding(
        run.id,
        { ...finding, findingKey: "conflicting-finding", status: "verified" },
        winnerAuth,
        request,
      ),
      submitVerificationFinding(
        run.id,
        { ...finding, findingKey: "conflicting-finding", status: "discrepancy" },
        winnerAuth,
        request,
      ),
    ]);
    expect(conflicting.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(conflicting.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await prisma.verificationFinding.count({
        where: { verificationRunId: run.id, findingKey: "conflicting-finding" },
      }),
    ).toBe(1);

    const terminal = await Promise.allSettled([
      transitionVerificationRun(run.id, { status: "completed" }, { verifier: winnerAuth, request }),
      transitionVerificationRun(
        run.id,
        { status: "failed", reason: "Concurrent external failure." },
        { verifier: winnerAuth, request },
      ),
    ]);
    expect(terminal.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(["completed", "failed"]).toContain(
      (await prisma.verificationRun.findUniqueOrThrow({ where: { id: run.id } })).status,
    );

    const expired = await makeRun("expired-reclaim");
    const pastIssued = new Date(Date.now() - 120_000);
    const pastExpiry = new Date(Date.now() - 60_000);
    await prisma.verificationRun.update({
      where: { id: expired.id },
      data: {
        status: "claimed",
        claimedVerifierId: verifierA.id,
        claimedAt: pastIssued,
        leaseTokenHash: sha("expired-lease"),
        leaseIssuedAt: pastIssued,
        leaseExpiresAt: pastExpiry,
        leaseGeneration: 1,
      },
    });
    const reclaimed = await claimVerificationRun(expired.id, authB, 300);
    expect(reclaimed).toMatchObject({ claimedVerifierId: verifierB.id, status: "claimed" });
    expect(
      await prisma.verificationRunLifecycleEvent.count({
        where: { verificationRunId: expired.id, kind: "reclaimed" },
      }),
    ).toBe(1);

    const cancellationRun = await makeRun("claim-cancel-race");
    await Promise.allSettled([
      claimVerificationRun(cancellationRun.id, authA, 300),
      transitionVerificationRun(
        cancellationRun.id,
        { status: "cancelled", reason: "Editorial cancellation raced with claim." },
        { userId: admin.id },
      ),
    ]);
    const cancellationState = await prisma.verificationRun.findUniqueOrThrow({
      where: { id: cancellationRun.id },
    });
    expect(["claimed", "cancelled"]).toContain(cancellationState.status);
    if (cancellationState.status === "cancelled")
      expect(cancellationState.completedAt).not.toBeNull();
  });
});
