/* eslint-disable @typescript-eslint/no-explicit-any -- documents are mutated to probe each rule */
import { describe, expect, it } from "vitest";
import {
  SOURCE_CREDIT_OBSERVATIONS_V2_VERSION,
  SOURCE_CREDIT_OBSERVATIONS_VERSION,
  SOURCE_CREDIT_PRODUCER_PINS,
  isChecksumValidOrcid,
  sourceCreditObservationsAnyVersionSchema,
  sourceCreditObservationsSchema,
  sourceCreditObservationsV2Schema,
} from "./source-credit-observations.js";

const sha = (character: string) => "sha256:" + character.repeat(64);
const id = (prefix: string, channel: string, character: string) =>
  `${prefix}${channel}:${character.repeat(64)}`;
const target = {
  kind: "source-finding",
  sourceId: "finding:x",
  sourceVersion: "1",
  bindingSha256: null,
  packetId: "packet:x",
  packetManifestSha256: sha("a"),
  lineageSha256: null,
};
const report = (accepted: number, withheld = 0) => ({
  accepted,
  withheld,
  unmappable: 0,
  reasonCodes: [],
  legacyRoleLabels: { preserved: 0, sourceUnmappable: 0, sourceCreditIneligible: 0 },
  producerDeclaredOmissions: null,
  omittedSourceFields: [],
});
const assertion = (observationId: string, person: unknown) => ({
  observationId,
  target,
  sourceAssertionId: "contribution:x",
  person,
  capacity: "finding-curator",
  role: null,
  sourceStatus: "confirmed",
  sourceDecisionRef: null,
  sourceDeclarationKind: null,
  sourceAssertedAt: null,
  sourceDisclosure: {
    kind: "diggypaper-contribution",
    personConsent: "granted",
    controllerAuthorization: "granted",
    membership: "active",
    consentRef: "consent:x",
    reviewBlinding: "not-applicable",
  },
  sourceAudience: "project-members",
  destinationStatus: "not-adjudicated",
  oratlasDisclosure: "not-authorized",
  assessmentIds: [],
});
const named = (orcid: unknown) => ({
  kind: "named",
  sourcePersonId: null,
  legacySourcePersonId: null,
  displayName: "Synthetic Person",
  orcid,
});
const verifiedOrcid = {
  id: "0000-0002-1825-0097",
  sourceStatus: "source-verified",
  nativeStatus: "oauth-verified",
  verificationMethod: null,
  verificationRef: "orcid-verification:x",
  verifiedAt: "2026-09-02T00:00:00Z",
};

function diggypaper(): any {
  const pin = SOURCE_CREDIT_PRODUCER_PINS.diggypaper;
  return {
    schemaVersion: SOURCE_CREDIT_OBSERVATIONS_V2_VERSION,
    producer: "diggypaper",
    producerContract: pin.contract,
    sourceContractPinnedCommit: pin.commit,
    sourceId: "credit:x",
    sourceDocumentSha256: sha("b"),
    visibility: "private-adapter-output",
    accessEffect: "none",
    accountVerification: "not-performed",
    sourceDocument: {
      kind: "diggypaper-companion",
      companionId: "credit:x",
      createdAt: "2026-09-04T00:00:00Z",
      creationMethod: "synthetic-fixture",
      producer: { name: "builder", commit: "synthetic-fixture" },
      audience: { level: "project-members", recipientRef: null, expiresAt: null },
      release: { state: "not-released", approvalRef: null, approvedAt: null },
      creditSemantics: {
        roleVocabulary: "CRediT ANSI/NISO Z39.104-2022",
        impliesAuthorship: false,
      },
      exportStatus: {
        state: "complete",
        withheldCounts: { entries: 0, contributions: 0 },
        reasons: [],
      },
      packet: {
        packetId: "packet:x",
        schemaVersion: "source-evidence-packet/0.1.0",
        manifestSha256: sha("a"),
        accessScopeLevel: "private",
        producer: { name: "builder", commit: "synthetic-fixture" },
      },
    },
    assertions: [
      assertion(id(pin.idPrefix, "credit", "1"), named(verifiedOrcid)),
      assertion(id(pin.idPrefix, "credit", "2"), { kind: "withheld" }),
    ],
    evidence: [],
    production: [],
    sourceLegacyRoleLabels: [],
    candidateContacts: [],
    candidateCreditClaims: [],
    report: report(2, 1),
  };
}

const rosterAssertion = (basis = "owner-curated") => ({
  basis,
  method: "curator-entry",
  assertedAt: "2026-09-01T09:00:00Z",
  assertedBy: "m-a",
  evidence: { sourceRecordVersion: null, reference: null },
});

function roster(): any {
  const pin = SOURCE_CREDIT_PRODUCER_PINS["orcid-playground"];
  return {
    ...diggypaper(),
    producer: "orcid-playground",
    producerContract: pin.contract,
    sourceContractPinnedCommit: pin.commit,
    sourceId: "roster:x",
    sourceDocument: {
      kind: "orcid-roster",
      exportId: "roster:x",
      generatedAt: "2026-10-01T09:00:00Z",
      origin: "local-offline-roster",
      distribution: "private-recipient-only",
      sourceAccessEffect: {
        grants: "none",
        invitations: "none",
        accounts: "none",
        authorship: "not-implied",
        credit: "not-inferred",
      },
      consent: {
        status: "granted",
        scope: "roster-export",
        method: "local-explicit-opt-in",
        grantedAt: "2026-10-01T08:55:00Z",
        grantedBy: "m-a",
        revokedAt: null,
      },
      redaction: {
        policy: "default-private",
        memberFields: ["orcid"],
        privateMembers: "omitted",
        excludedOutputs: [],
        projectReferences: "omitted",
      },
      group: { localId: "grp", createdBy: "m-a" },
      digest: { algorithm: "sha256", value: "c".repeat(64) },
    },
    assertions: [],
    candidateContacts: [
      {
        observationId: id(pin.idPrefix, "contact", "1"),
        sourceMemberRef: "m-a",
        displayName: null,
        localRole: null,
        orcid: {
          id: "0000-0002-1825-0097",
          uri: "https://orcid.org/0000-0002-1825-0097",
          nativeStatus: "claimed",
          assertion: rosterAssertion(),
        },
        membership: { nativeStatus: "listed-member", assertion: rosterAssertion() },
        personAssertion: rosterAssertion(),
        destinationStatus: "candidate-only",
        accessEffect: "none",
      },
    ],
    candidateCreditClaims: [
      {
        observationId: id(pin.idPrefix, "credit-claim", "2"),
        sourceMemberRef: "m-a",
        output: {
          sourceOutputRef: "o-1",
          doi: "10.5555/x",
          doiIsExample: true,
          sourceRights: "owner-provided",
          assertion: rosterAssertion(),
        },
        role: {
          slug: "software",
          originalLabel: "software",
          degree: null,
          declarationRef: null,
          roleUri: null,
        },
        sourceStatus: "curator-confirmed",
        assertion: rosterAssertion(),
        destinationStatus: "candidate-only",
        accessEffect: "none",
        confirmedByImport: false,
      },
    ],
    report: report(2),
  };
}

const rejects = (document: unknown) =>
  expect(sourceCreditObservationsV2Schema.safeParse(document).success).toBe(false);

describe("source-credit-observations 0.2.0 neutral contract", () => {
  it("accepts minimal well-formed Diggypaper and roster documents", () => {
    expect(sourceCreditObservationsV2Schema.safeParse(diggypaper()).success).toBe(true);
    expect(sourceCreditObservationsV2Schema.safeParse(roster()).success).toBe(true);
  });

  it.each([
    ["another producer's contract", (d: any) => (d.producerContract = "comprev.contributorship/1")],
    ["an unpinned commit", (d: any) => (d.sourceContractPinnedCommit = "0".repeat(40))],
    ["a producer/document mismatch", (d: any) => (d.producer = "computational-review-template")],
    [
      "the 0.1.0 version string",
      (d: any) => (d.schemaVersion = SOURCE_CREDIT_OBSERVATIONS_VERSION),
    ],
  ])("rejects %s", (_, apply) => {
    const document = diggypaper();
    apply(document);
    rejects(document);
  });

  it("requires every producer pin to be exact and distinct", () => {
    const pins = Object.values(SOURCE_CREDIT_PRODUCER_PINS);
    expect(pins.every((pin) => /^[0-9a-f]{40}$/u.test(pin.commit))).toBe(true);
    expect(new Set(pins.map((pin) => pin.idPrefix)).size).toBe(pins.length);
    expect(SOURCE_CREDIT_PRODUCER_PINS).toMatchObject({
      diggypaper: { contract: "finding-credit-companion/0.1.0" },
      "computational-review-template": { contract: "comprev.contributorship/1" },
      "orcid-playground": { contract: "orcid-playground/roster-assertion/0.1.0" },
    });
  });

  it.each([
    [
      "a duplicated observation id",
      (d: any) => (d.assertions[1].observationId = d.assertions[0].observationId),
    ],
    ["unsorted observation ids", (d: any) => d.assertions.reverse()],
    [
      "a foreign id prefix",
      (d: any) => (d.assertions[1].observationId = id("crt:", "credit", "2")),
    ],
    ["an overstated accepted count", (d: any) => (d.report.accepted = 3)],
    ["an understated withheld count", (d: any) => (d.report.withheld = 0)],
    ["unsorted reason codes", (d: any) => (d.report.reasonCodes = ["b", "a"])],
    ["a non-code reason", (d: any) => (d.report.reasonCodes = ["Synthetic Person"])],
    ["a legacy count without labels", (d: any) => (d.report.legacyRoleLabels.preserved = 1)],
    [
      "a roster channel from Diggypaper",
      (d: any) => d.candidateContacts.push(roster().candidateContacts[0]),
    ],
  ])("rejects %s", (_, apply) => {
    const document = diggypaper();
    apply(document);
    rejects(document);
  });

  it.each([
    ["source-verified without evidence", { ...verifiedOrcid, verificationRef: null }],
    ["claimed with evidence", { ...verifiedOrcid, sourceStatus: "claimed" }],
    ["a checksum-invalid iD", { ...verifiedOrcid, id: "0000-0002-1825-0098" }],
  ])("rejects a source ORCID that is %s", (_, orcid) => {
    const document = diggypaper();
    document.assertions[0].person = named(orcid);
    rejects(document);
  });

  it("checks ORCID iD checksums deterministically", () => {
    expect(isChecksumValidOrcid("0000-0002-1825-0097")).toBe(true);
    expect(isChecksumValidOrcid("0000-0000-0000-001X")).toBe(true);
    expect(isChecksumValidOrcid("0000-0002-1825-0098")).toBe(false);
    expect(isChecksumValidOrcid("0000-0002-1825-009")).toBe(false);
  });

  it.each([
    ["an unselected display name", (d: any) => (d.candidateContacts[0].displayName = "Dana")],
    ["an unselected ORCID", (d: any) => (d.sourceDocument.redaction.memberFields = [])],
    [
      "an offline OAuth-verified iD",
      (d: any) => (d.candidateContacts[0].orcid.nativeStatus = "oauth-verified"),
    ],
    [
      "offline external verification",
      (d: any) => (d.candidateContacts[0].personAssertion = rosterAssertion("external-verified")),
    ],
    [
      "a claim for an absent member",
      (d: any) => (d.candidateCreditClaims[0].sourceMemberRef = "m-z"),
    ],
    [
      "an unflagged example DOI",
      (d: any) => (d.candidateCreditClaims[0].output.doiIsExample = false),
    ],
    [
      "a confirmed-by-import claim",
      (d: any) => (d.candidateCreditClaims[0].confirmedByImport = true),
    ],
    ["observations after revocation", (d: any) => (d.sourceDocument.consent.status = "revoked")],
    ["a human assertion channel", (d: any) => d.assertions.push(diggypaper().assertions[0])],
  ])("rejects a roster with %s", (_, apply) => {
    const document = roster();
    apply(document);
    rejects(document);
  });

  it("requires external evidence for an OAuth-verified iD from an external platform", () => {
    const document = roster();
    document.sourceDocument.origin = "external-platform";
    document.candidateContacts[0].orcid.nativeStatus = "oauth-verified";
    rejects(document);
    document.candidateContacts[0].orcid.assertion = {
      ...rosterAssertion("external-verified"),
      evidence: { sourceRecordVersion: null, reference: "orcid-oauth:x" },
    };
    expect(sourceCreditObservationsV2Schema.safeParse(document).success).toBe(true);
  });

  it("never lets software agents be CRediT-eligible legacy subjects", () => {
    const pin = SOURCE_CREDIT_PRODUCER_PINS["computational-review-template"];
    const document = {
      ...diggypaper(),
      producer: "computational-review-template",
      producerContract: pin.contract,
      sourceContractPinnedCommit: pin.commit,
      sourceDocument: {
        kind: "crt-contributorship",
        reviewId: "review-x",
        version: "1.0.0",
        claimGraphSha256: sha("d"),
        claimGraphBytesVerified: false,
        visibility: "private",
        creditStandard: "ANSI/NISO Z39.104-2022",
      },
      assertions: [],
      sourceLegacyRoleLabels: [
        {
          observationId: id(pin.idPrefix, "legacy-role-label", "1"),
          target: { ...target, kind: "review" },
          subject: { kind: "software-agent", sourceAgentId: "ai-pipeline" },
          field: "roles",
          position: 0,
          label: "Investigation",
          level: null,
          sourceMappedRole: "investigation",
          sourceMapping: "exact",
          sourceCreditEligible: false,
          sourceRef: null,
        },
      ],
      report: {
        ...report(0),
        legacyRoleLabels: { preserved: 1, sourceUnmappable: 0, sourceCreditIneligible: 1 },
      },
    };
    expect(sourceCreditObservationsV2Schema.safeParse(document).success).toBe(true);
    (document.sourceLegacyRoleLabels[0] as any).sourceCreditEligible = true;
    document.report.legacyRoleLabels.sourceCreditIneligible = 0;
    rejects(document);
  });
});

describe("0.1.0 legacy contract stays intact and version-gated", () => {
  const legacy = {
    schemaVersion: "oratlas.source-credit-observations/0.1.0",
    producer: "orcid-playground",
    producerContract: "orcid-playground/roster-assertion/0.1.0",
    sourceContractPinnedCommit: SOURCE_CREDIT_PRODUCER_PINS["orcid-playground"].commit,
    sourceId: "roster:x",
    sourceDocumentSha256: sha("e"),
    visibility: "private-adapter-output",
    accessEffect: "none",
    accountVerification: "not-performed",
    assertions: [],
    evidence: [],
    production: [],
    candidateContacts: [],
    report: { accepted: 0, withheld: 0, unmappable: 0, reasonCodes: [] },
  };

  it("keeps the 0.1.0 version constant and shape", () => {
    expect(SOURCE_CREDIT_OBSERVATIONS_VERSION).toBe("oratlas.source-credit-observations/0.1.0");
    expect(sourceCreditObservationsSchema.safeParse(legacy).success).toBe(true);
  });

  it("never parses one version with the other's schema", () => {
    expect(sourceCreditObservationsV2Schema.safeParse(legacy).success).toBe(false);
    expect(sourceCreditObservationsSchema.safeParse(roster()).success).toBe(false);
    expect(sourceCreditObservationsAnyVersionSchema.parse(legacy).schemaVersion).toBe(
      "oratlas.source-credit-observations/0.1.0",
    );
    expect(sourceCreditObservationsAnyVersionSchema.parse(roster()).schemaVersion).toBe(
      SOURCE_CREDIT_OBSERVATIONS_V2_VERSION,
    );
  });
});
