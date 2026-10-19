/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic upstream payloads are mutated to test fail-closed behavior */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  SOURCE_CREDIT_OBSERVATIONS_V2_VERSION,
  SOURCE_CREDIT_PRODUCER_PINS,
  canonicalJson,
  sourceCreditObservationsSchema,
  sourceCreditObservationsV2Schema,
  type SourceCreditObservationsV2,
} from "@oratlas/contracts";
import { adaptDiggypaperCredit } from "./source-credit-diggypaper.js";
import { adaptCRTContributorship } from "./source-credit-crt.js";
import { adaptOrcidRoster } from "./source-credit-orcid.js";
import { SourceCreditAdapterError, mapCreditRole } from "./source-credit-adapter-shared.js";

const FIXTURES = new URL("./fixtures/source-credit-interop/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const rawDiggy = read("diggypaper/credit.json");
const rawCRT = read("crt/credit.json");
const rawCRTGraph = read("crt/claim-graph.json");
const rawRoster = read("orcid/roster.json");
const rosterReading = JSON.parse(read("orcid/candidate-contacts.json"));
const nativeDiggy = read("schemas/diggypaper.schema.json");
const nativeCRT = read("schemas/crt.private.schema.json");
const nativeRoster = read("schemas/orcid.roster.schema.json");
const packetManifest = read("diggypaper/packet/manifest.json");
const diggyPacket = () => ({
  manifest: packetManifest,
  papers: read("diggypaper/packet/papers.jsonl"),
  findings: read("diggypaper/packet/findings.jsonl"),
  passages: read("diggypaper/packet/passages.jsonl"),
  assessments: read("diggypaper/packet/assessments.jsonl"),
});

const mutate = (raw: string, apply: (data: Record<string, any>) => void): string => {
  const data = JSON.parse(raw) as Record<string, any>;
  apply(data);
  return JSON.stringify(data);
};
const rehashRoster = (data: Record<string, any>): void => {
  const { digest: _oldDigest, ...payload } = data;
  data.digest.value = createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
};
const mutateRoster = (apply: (data: Record<string, any>) => void): string =>
  mutate(rawRoster, (data) => {
    apply(data);
    rehashRoster(data);
  });
const contributions = (doc: Record<string, any>): any[] =>
  doc.entries.flatMap((entry: any) => entry.contributions);
const firstNamed = (doc: Record<string, any>) =>
  contributions(doc).find((c: any) => c.contributor.kind === "disclosed");
const sameExceptSourceBytes = (
  left: SourceCreditObservationsV2,
  right: SourceCreditObservationsV2,
) => expect({ ...left, sourceDocumentSha256: right.sourceDocumentSha256 }).toEqual(right);

describe("byte-pinned upstream fixtures", () => {
  const pins = JSON.parse(read("PINS.json")) as {
    files: {
      path: string;
      producer: keyof typeof SOURCE_CREDIT_PRODUCER_PINS;
      commit: string;
      sha256: string;
      bytes: number;
    }[];
  };

  it.each(pins.files.map((file) => [file.path, file] as const))(
    "%s still has its exact pinned upstream bytes",
    (path, file) => {
      const bytes = readFileSync(new URL(path, FIXTURES));
      expect("sha256:" + createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
      expect(bytes.length).toBe(file.bytes);
      expect(file.commit).toBe(SOURCE_CREDIT_PRODUCER_PINS[file.producer].commit);
    },
  );

  it("pins every upstream file shipped in the fixture directory", () => {
    const walk = (dir: URL, prefix = ""): string[] =>
      readdirSync(dir).flatMap((name) =>
        statSync(new URL(name, dir)).isDirectory()
          ? walk(new URL(name + "/", dir), prefix + name + "/")
          : [prefix + name],
      );
    const shipped = walk(FIXTURES).filter((p) => p !== "PINS.json" && !p.startsWith("golden/"));
    expect(shipped.sort()).toEqual(pins.files.map((f) => f.path).sort());
  });

  it.each([
    ["diggypaper", nativeDiggy, rawDiggy],
    ["CRT", nativeCRT, rawCRT],
    ["ORCID roster", nativeRoster, rawRoster],
  ])("validates the %s fixture against its frozen producer JSON Schema", (_, schemaText, raw) => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(schemaText));
    expect(validate(JSON.parse(raw)), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe("complete deterministic golden outputs (0.2.0)", () => {
  const cases: [string, () => SourceCreditObservationsV2][] = [
    ["diggypaper", () => adaptDiggypaperCredit(rawDiggy, diggyPacket())],
    ["crt", () => adaptCRTContributorship(rawCRT, rawCRTGraph)],
    ["orcid", () => adaptOrcidRoster(rawRoster)],
  ];
  it.each(cases)("%s matches its golden file byte for byte", (name, run) => {
    const serialized = JSON.stringify(run(), null, 2) + "\n";
    const file = new URL(`golden/${name}.observations.json`, FIXTURES);
    // Regenerate deliberately: UPDATE_SOURCE_CREDIT_GOLDEN=1 pnpm exec vitest run <this file>
    if (process.env.UPDATE_SOURCE_CREDIT_GOLDEN === "1") writeFileSync(file, serialized);
    expect(serialized).toBe(readFileSync(file, "utf8"));
    const parsed = sourceCreditObservationsV2Schema.parse(JSON.parse(serialized));
    expect(parsed.schemaVersion).toBe(SOURCE_CREDIT_OBSERVATIONS_V2_VERSION);
    // The legacy 0.1.0 schema refuses 0.2.0 output explicitly instead of misreading it.
    expect(sourceCreditObservationsSchema.safeParse(parsed).success).toBe(false);
  });

  it("differs without claim-graph bytes only in the verification flag and reason code", () => {
    const verified = adaptCRTContributorship(rawCRT, rawCRTGraph);
    const unverified = adaptCRTContributorship(rawCRT);
    expect(unverified.report.reasonCodes).toEqual(
      [...verified.report.reasonCodes, "claim-graph-bytes-not-supplied"].sort(),
    );
    expect(unverified.sourceDocument).toMatchObject({ claimGraphBytesVerified: false });
    expect({
      ...unverified,
      sourceDocument: verified.sourceDocument,
      report: verified.report,
    }).toEqual(verified);
  });
});

describe("Diggypaper: separate credit, citation, evidence and production", () => {
  const result = adaptDiggypaperCredit(rawDiggy, diggyPacket());
  const source = JSON.parse(rawDiggy);

  it("keeps producer, audience, release, export status and the no-authorship constant", () => {
    expect(result.sourceDocument).toEqual({
      kind: "diggypaper-companion",
      companionId: source.companion_id,
      createdAt: source.created_at,
      creationMethod: "synthetic-fixture",
      producer: { name: "diggypaper-fixture-builder", commit: "synthetic-fixture" },
      audience: { level: "project-members", recipientRef: null, expiresAt: "2027-03-01T00:00:00Z" },
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
      packet: expect.objectContaining({
        packetId: "packet:credit-synthetic",
        manifestSha256: source.packet.packet_digest,
        accessScopeLevel: "private",
      }),
    });
    expect(result.report.producerDeclaredOmissions).toEqual({
      state: "complete",
      counts: { entries: 0, contributions: 0 },
      reasons: [],
    });
    expect(result.report.omittedSourceFields).toContain("diggypaper.audience.purpose");
    expect(JSON.stringify(result)).not.toContain(source.audience.purpose);
  });

  it("keeps finding origin, snapshot ref, rights and passages per exact revision", () => {
    const f1 = result.evidence.find((e) => e.target.sourceId === "finding:credit-a-f1")!;
    expect(f1.target.sourceVersion).toBe("2");
    expect(f1.findingOrigin).toBe("source-explicit");
    expect(f1.sourceSnapshotRef).toBe("snapshot:credit-a-1");
    expect(f1.sourceRights).toMatchObject({
      kind: "diggypaper-paper-rights",
      license: "CC-BY-4.0",
      redistribution: "allowed",
    });
    expect(f1.citedWork).toMatchObject({ doi: "10.5555/credit.a", doiIsExample: true });
    const c1 = result.evidence.find((e) => e.target.sourceId === "finding:credit-c-f1")!;
    expect(c1.sourceRights).toMatchObject({ redistribution: "restricted", license: "proprietary" });
    expect(c1.passages).toEqual([
      expect.objectContaining({ passageId: "passage:credit-c-p1", quoteState: "withheld-rights" }),
    ]);
    expect(c1.assessmentProtocol).toBe("seip-support-v1");
    expect(c1.sourceAssessments).toEqual([]);
  });

  it("never turns a contribution id into a person id or a packet reviewer ref into credit", () => {
    for (const assertion of result.assertions) {
      expect(assertion.sourceAssertionId).toMatch(/^contribution:/u);
      if (assertion.person.kind === "named") expect(assertion.person.sourcePersonId).toBeNull();
    }
    // assessment:credit-a4's packet reviewer is withheld by the companion.
    expect(JSON.stringify(result)).not.toContain("rv-dddddddddddddddddddddddddddddddd");
    const withheld = result.assertions.filter((a) => a.person.kind === "withheld");
    expect(withheld.map((a) => a.sourceAssertionId).sort()).toEqual([
      "contribution:a-f2-assessor-d",
      "contribution:b-f1-proposer",
      "contribution:b-f1-team",
    ]);
    expect(result.report.withheld).toBe(withheld.length);
  });

  it("separates human source ORCID claims from source verification", () => {
    const named = result.assertions.flatMap((a) => (a.person.kind === "named" ? [a.person] : []));
    expect(named.map((p) => p.orcid?.sourceStatus).sort()).toEqual(["claimed", "source-verified"]);
    const claimed = named.find((p) => p.orcid?.sourceStatus === "claimed")!;
    expect(claimed.orcid).toMatchObject({ verificationRef: null, verifiedAt: null });
  });

  it("keeps ml-model production as native agent type with an exact run ref or none", () => {
    expect(result.production.map((p) => p.agentType).sort()).toEqual([
      "ml-model",
      "ml-model",
      "ml-model",
      "software",
      "software",
      "software",
    ]);
    expect(result.production.every((p) => p.actorKind === "software")).toBe(true);
    expect(
      result.production.filter((p) => p.agentType === "software").every((p) => p.runRef === null),
    ).toBe(true);
    expect(
      result.production
        .filter((p) => p.agentType === "ml-model")
        .every((p) => p.runRef?.startsWith("prediction-")),
    ).toBe(true);
  });

  it("keeps the confirmed-without-decision-ref flag instead of synthesizing a reference", () => {
    expect(result.report.reasonCodes).toContain("source-confirmed-without-decision-ref");
    const team = result.assertions.find((a) => a.sourceAssertionId === "contribution:b-f1-team")!;
    expect(team.sourceDecisionRef).toBeNull();
    expect(team.destinationStatus).toBe("not-adjudicated");
  });

  it("is invariant to nested permutations, including production order", () => {
    const permuted = adaptDiggypaperCredit(
      mutate(rawDiggy, (doc) => {
        doc.entries.reverse();
        for (const entry of doc.entries) {
          entry.contributions.reverse();
          entry.production.reverse();
          entry.binding.passage_ids.reverse();
          entry.binding.assessment_ids.reverse();
          for (const c of entry.contributions) c.credit_roles.reverse();
        }
      }),
      diggyPacket(),
    );
    sameExceptSourceBytes(permuted, result);
  });
});

describe("Diggypaper fail-closed checks", () => {
  const expectCode = (raw: string, code: string, packet = diggyPacket()) =>
    expect(() => adaptDiggypaperCredit(raw, packet)).toThrow(code);

  it.each([
    ["wrong companion version", (d: any) => (d.schema_version = "finding-credit-companion/0.2.0")],
    [
      "wrong packet version",
      (d: any) => (d.packet.schema_version = "source-evidence-packet/0.2.0"),
    ],
    ["authorship implied", (d: any) => (d.credit_semantics.implies_authorship = true)],
    ["other role vocabulary", (d: any) => (d.credit_semantics.role_vocabulary = "CRediT")],
    ["undeclared field", (d: any) => (d.extra = true)],
    [
      "withheld ref changed",
      (d: any) =>
        (contributions(d).find((c: any) => c.contributor.kind === "withheld").contributor.ref =
          "someone"),
    ],
    ["bad pseudonym", (d: any) => (contributions(d)[0].contributor.ref = "Dana")],
    ["non-CRediT label", (d: any) => (firstNamed(d).credit_roles[0].role = "Lead author")],
    ["bad companion id", (d: any) => (d.companion_id = "companion-1")],
    ["bad production activity", (d: any) => (d.entries[0].production[0].activity = "authorship")],
  ])("rejects %s as source-schema-incompatible", (_, apply) => {
    expectCode(mutate(rawDiggy, apply), "source-schema-incompatible");
  });

  it.each([
    ["withheld", "disclosure-status-contradiction"],
    ["withdrawn", "credit-role-on-inactive-contribution"],
    ["disputed", "credit-role-on-inactive-contribution"],
  ])("refuses a disclosed name on a %s credit without leaking it", (status, code) => {
    const name: string = firstNamed(JSON.parse(rawDiggy)).contributor.display_name;
    const raw = mutate(rawDiggy, (doc) => {
      firstNamed(doc).status = status;
    });
    try {
      adaptDiggypaperCredit(raw, diggyPacket());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SourceCreditAdapterError);
      expect((error as Error).message).toBe(code);
      expect(String(error) + JSON.stringify(error)).not.toContain(name);
    }
  });

  it("refuses a disclosed inactive credit even without roles", () => {
    const raw = mutate(rawDiggy, (doc) => {
      firstNamed(doc).status = "withdrawn";
      firstNamed(doc).credit_roles = [];
    });
    expectCode(raw, "disclosure-not-authorized");
  });

  it.each([
    ["person consent revoked", (c: any) => (c.disclosure.person_consent = "revoked")],
    ["controller not granted", (c: any) => (c.disclosure.controller_authorization = "not-granted")],
    ["membership revoked", (c: any) => (c.disclosure.membership = "revoked")],
    ["no consent reference", (c: any) => (c.disclosure.consent_ref = "not-available")],
  ])("refuses to name a contributor when %s", (_, apply) => {
    expectCode(
      mutate(rawDiggy, (doc) => apply(firstNamed(doc))),
      "disclosure-not-authorized",
    );
  });

  it("refuses a disclosed blinded assessor", () => {
    const raw = mutate(rawDiggy, (doc) => {
      const assessor = contributions(doc).find(
        (c: any) => c.contribution_id === "contribution:a-f1-assessor-b",
      );
      assessor.contributor = structuredClone(firstNamed(doc).contributor);
      assessor.disclosure = structuredClone(firstNamed(doc).disclosure);
      assessor.review_blinding = "blinded";
    });
    expectCode(raw, "disclosure-not-authorized");
  });

  it("refuses an assessor pseudonym that differs from the packet's reviewer", () => {
    const raw = mutate(rawDiggy, (doc) => {
      contributions(doc).find(
        (c: any) => c.contribution_id === "contribution:a-f1-assessor-b",
      ).contributor.ref = "rv-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    });
    expectCode(raw, "assessor-pseudonym-mismatch");
  });

  it.each([
    [
      "checksum-invalid ORCID",
      (o: any) => (o.id = "0000-0002-1825-0098"),
      "source-identity-invalid",
    ],
    [
      "verified without proof",
      (o: any) => (o.verification_ref = "not-available"),
      "source-orcid-evidence-missing",
    ],
    [
      "claimed with proof",
      (o: any) => (o.verification = "claimed-unverified"),
      "source-orcid-evidence-missing",
    ],
  ])("refuses a %s", (_, apply, code) => {
    expectCode(
      mutate(rawDiggy, (doc) => apply(firstNamed(doc).contributor.orcid)),
      code,
    );
  });

  it("refuses a production agent credited as a person", () => {
    const raw = mutate(rawDiggy, (doc) => {
      firstNamed(doc).contributor.display_name = "Quote-Matcher-v1";
    });
    expectCode(raw, "software-credited-as-person");
  });

  it.each([
    [
      "complete with withheld counts",
      (d: any) => (d.export_status.withheld_counts.entries = 1),
      "source-export-status-inconsistent",
    ],
    [
      "partial without counts",
      (d: any) => (d.export_status.state = "partial"),
      "source-export-status-inconsistent",
    ],
    [
      "public without approval",
      (d: any) => (d.audience.level = "public"),
      "source-release-not-approved",
    ],
    [
      "recipient without named audience",
      (d: any) => (d.audience.recipient_ref = "recipient:x"),
      "source-audience-inconsistent",
    ],
    [
      "approval data on unreleased",
      (d: any) => (d.release.approval_ref = "approval:x"),
      "source-release-inconsistent",
    ],
    [
      "expired before creation",
      (d: any) => (d.audience.expires_at = "2026-01-01T00:00:00Z"),
      "source-handoff-expired",
    ],
  ])("refuses a header with %s", (_, apply, code) => {
    expectCode(mutate(rawDiggy, apply), code);
  });

  it("refuses changed packet bytes, stale revisions, duplicate entries and duplicate production", () => {
    const bad = diggyPacket();
    bad.passages = bad.passages.replace("sha256:", "sha256:0");
    expectCode(rawDiggy, "packet-artifact-digest-mismatch", bad);
    expectCode(rawDiggy, "packet-manifest-binding-mismatch", {
      ...diggyPacket(),
      manifest: packetManifest.replace(/\n$/u, " \n"),
    });
    expectCode(
      mutate(rawDiggy, (d) => (d.entries[0].binding.finding_revision = 1)),
      "finding-revision-or-packet-invalid",
    );
    expectCode(
      mutate(rawDiggy, (d) => (d.entries[0].binding.finding_revision = 100)),
      "finding-revision-or-packet-invalid",
    );
    expectCode(
      mutate(rawDiggy, (d) => d.entries.push(structuredClone(d.entries[0]))),
      "duplicate-credit-entry",
    );
    expectCode(
      mutate(rawDiggy, (d) =>
        d.entries[1].production.push(structuredClone(d.entries[1].production[0])),
      ),
      "duplicate-production-record",
    );
    expectCode(
      mutate(rawDiggy, (d) => (d.entries[0].binding.finding_origin = "ai-paraphrase")),
      "finding-source-binding-mismatch",
    );
  });

  it.each([
    ["invalid JSON", "{not json", "source-invalid-json"],
    ["a JSON array", "[]", "source-invalid-json"],
    ["oversize input", " ".repeat(3_000_001), "source-oversize"],
  ])("refuses %s", (_, raw, code) => {
    expectCode(raw, code);
  });
});

describe("CRT: structured source facts without new authorship", () => {
  const result = adaptCRTContributorship(rawCRT, rawCRTGraph);

  it("keeps passage disclosure, assessment protocol/status and curator pseudonyms on evidence", () => {
    const alpha = result.evidence.find((e) => e.target.sourceId === "finding:alpha-f1")!;
    expect(alpha.sourceRights).toEqual({
      kind: "crt-passage-disclosure",
      passageDisclosure: "rights-allow",
    });
    expect(alpha.sourceAssessments).toEqual([
      {
        assessmentId: "assessment:alpha-a1",
        protocol: "seip-support-v1",
        status: "supports",
        curatorRef: { kind: "source-native-pseudonym", ref: "rv-a1a1a1a1a1a1a1a1" },
        assessedSnapshotSha256: null,
      },
    ]);
    expect(alpha.mapping).toEqual({
      binding: "reviewed-mapping",
      claimId: "clm_c7ed170000000001",
      decisionRef: "decision:map-alpha",
      mappedAt: "2026-09-04T00:00:00Z",
      claimDisclosure: { public: true, reason: null, approvedFields: null, approvalIds: [] },
    });
    expect(alpha.citedWork).toMatchObject({ citeKey: "synthAlpha2026", doiIsExample: true });
  });

  it("never turns a source curator pseudonym into a review contributor", () => {
    const curators = result.evidence.flatMap((e) =>
      e.sourceAssessments.map((a) => a.curatorRef?.ref),
    );
    expect(curators).toHaveLength(3);
    expect(result.assertions.every((a) => a.person.kind === "named")).toBe(true);
    for (const assertion of result.assertions) {
      const person = assertion.person as { sourcePersonId: string; displayName: string };
      expect(curators).not.toContain(person.sourcePersonId);
    }
  });

  it("keeps a non-public private-companion identity with its source disclosure facts", () => {
    const c = result.assertions.find((a) => a.sourceAssertionId === "a-007")!;
    expect(c.person).toMatchObject({ kind: "named", sourcePersonId: "person-c" });
    expect(c.sourceDisclosure).toEqual({
      kind: "crt-contributor",
      public: false,
      reason: "missing-required-grant",
      approvedFields: [],
      approvalIds: [],
    });
    expect(c.oratlasDisclosure).toBe("not-authorized");
    expect(result.report.withheld).toBe(3);
  });

  it("keeps the agent id distinct from a run, with its producer and workflow role", () => {
    const claude = result.production.find((p) => p.sourceAgentId === "ai-pipeline")!;
    expect(claude).toMatchObject({
      softwareName: "Claude",
      softwareProducer: "Anthropic",
      agentType: "software-agent",
      runRef: null,
      activity: "evidence-gathering-and-drafting",
      legacyAuthorId: "ai-pipeline",
    });
  });

  it("preserves and separately counts legacy labels, including unmappable Statistics", () => {
    const statistics = result.sourceLegacyRoleLabels.find((l) => l.label === "Statistics")!;
    expect(statistics).toMatchObject({
      subject: { kind: "person", sourcePersonId: "person-d" },
      sourceMapping: "unmappable",
      sourceMappedRole: null,
      sourceCreditEligible: false,
      sourceRef: "content/authors.yml#person-d",
    });
    expect(result.report.legacyRoleLabels).toEqual({
      preserved: 8,
      sourceUnmappable: 1,
      sourceCreditIneligible: 5,
    });
    const agentLabels = result.sourceLegacyRoleLabels.filter(
      (l) => l.subject.kind === "software-agent",
    );
    expect(agentLabels).toHaveLength(4);
    expect(agentLabels.every((l) => !l.sourceCreditEligible)).toBe(true);
    // Labels are not observations and do not change the 0.1.0 accepted semantics.
    expect(result.report.accepted).toBe(
      result.assertions.length + result.evidence.length + result.production.length,
    );
  });

  it("does not carry private origin project metadata, credit statements or relation proposals", () => {
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("project:private-gamma-7f3a");
    expect(serialized).not.toContain("Synthetic Private Gamma Project");
    expect(serialized).not.toContain("credit_statement");
    expect(serialized).not.toContain("rel-001");
    expect(result.report.omittedSourceFields).toEqual([
      "crt.contributors.credit-statement",
      "crt.relation-proposals",
      "crt.source-origins.project-ref-and-title",
    ]);
    expect(result.report.unmappable).toBe(3);
  });

  it("is invariant to nested permutations", () => {
    const permuted = adaptCRTContributorship(
      mutate(rawCRT, (doc) => {
        doc.contributors.reverse();
        doc.credit_assertions.reverse();
        doc.legacy_role_labels.reverse();
        doc.source_origins.reverse();
        doc.source_credit.reverse();
        for (const record of doc.source_credit) {
          record.findings.reverse();
          for (const finding of record.findings) {
            finding.passages.reverse();
            finding.source_assessments.reverse();
          }
        }
        doc.production.agent_runs.reverse();
        for (const agent of doc.production.agent_runs) agent.legacy_role_labels.reverse();
        doc.relation_proposals.reverse();
        for (const contributor of doc.contributors)
          contributor.disclosure.approved_fields.reverse();
      }),
      rawCRTGraph,
    );
    sameExceptSourceBytes(permuted, result);
  });
});

describe("CRT fail-closed checks", () => {
  it.each([
    ["a newer contract", (d: any) => (d.schema = "comprev.contributorship/2")],
    ["a public companion", (d: any) => (d.visibility = "public")],
    [
      "review authorship for curation",
      (d: any) => (d.source_credit[0].findings[0].source_curation.review_authorship = true),
    ],
    [
      "a credit-eligible agent label",
      (d: any) => (d.production.agent_runs[0].legacy_role_labels[0].credit_eligible = true),
    ],
    ["an undeclared field", (d: any) => (d.contributors[0].email = "x")],
  ])("rejects %s as source-schema-incompatible", (_, apply) => {
    expect(() => adaptCRTContributorship(mutate(rawCRT, apply))).toThrow(
      "source-schema-incompatible",
    );
  });

  it.each([
    ["role label", (a: any) => (a.role_label = "Supervision"), "crt-role-label-inconsistent"],
    [
      "role URI",
      (a: any) => (a.role_uri = "https://credit.niso.org/contributor-roles/software/"),
      "crt-role-label-inconsistent",
    ],
    ["missing status ref", (a: any) => (a.status_ref = null), "crt-status-decision-invalid"],
    ["dangling contributor", (a: any) => (a.contributor = "person-z"), "crt-dangling-contributor"],
  ])("rejects an inconsistent %s", (_, apply, code) => {
    const raw = mutate(rawCRT, (doc) => apply(doc.credit_assertions[0]));
    expect(() => adaptCRTContributorship(raw)).toThrow(code);
  });

  it("rejects identity conflicts and checksum-invalid ORCIDs", () => {
    expect(() =>
      adaptCRTContributorship(
        mutate(rawCRT, (d) => (d.production.agent_runs[1].agent_id = "person-a")),
      ),
    ).toThrow("crt-agent-person-conflict");
    expect(() =>
      adaptCRTContributorship(
        mutate(rawCRT, (d) => (d.contributors[1].orcid.id = "0000-0000-0000-0010")),
      ),
    ).toThrow("source-identity-invalid");
    expect(() =>
      adaptCRTContributorship(mutate(rawCRT, (d) => delete d.contributors[0].orcid.verification)),
    ).toThrow("crt-orcid-evidence-missing");
    const claimedWithProof = mutate(rawCRT, (d) => {
      d.contributors[1].orcid.verification = d.contributors[0].orcid.verification;
    });
    expect(() => adaptCRTContributorship(claimedWithProof)).toThrow("crt-orcid-evidence-missing");
  });

  it("rejects duplicated legacy labels, findings and passages, and claim-graph drift", () => {
    expect(() =>
      adaptCRTContributorship(
        mutate(rawCRT, (d) => d.legacy_role_labels.push(structuredClone(d.legacy_role_labels[0]))),
      ),
    ).toThrow("crt-duplicate-legacy-label");
    expect(() =>
      adaptCRTContributorship(
        mutate(rawCRT, (d) => (d.legacy_role_labels[0].contributor = "person-z")),
      ),
    ).toThrow("crt-dangling-contributor");
    const findings = (d: any) => d.source_credit[0].findings;
    expect(() =>
      adaptCRTContributorship(
        mutate(rawCRT, (d) => findings(d).push(structuredClone(findings(d)[0]))),
      ),
    ).toThrow("crt-duplicate-finding");
    const crossPacket = mutate(rawCRT, (d) =>
      findings(d).push({
        ...findings(d)[0],
        packet: { ...findings(d)[0].packet, packet_id: "packet:crt17-beta" },
        origin_id: "origin-beta",
      }),
    );
    expect(() => adaptCRTContributorship(crossPacket)).toThrow("crt-duplicate-finding");
    expect(() =>
      adaptCRTContributorship(mutate(crossPacket, (d) => findings(d).reverse())),
    ).toThrow("crt-duplicate-finding");
    expect(() =>
      adaptCRTContributorship(
        mutate(rawCRT, (d) =>
          findings(d)[0].passages.push(structuredClone(findings(d)[0].passages[0])),
        ),
      ),
    ).toThrow("crt-duplicate-passage");
    expect(() => adaptCRTContributorship(rawCRT, rawCRTGraph.replace(/\n?$/u, " \n"))).toThrow(
      "claim-graph-sha256-mismatch",
    );
  });

  it.each([
    ["invalid JSON", "{", "source-invalid-json"],
    ["a JSON string", '"comprev"', "source-invalid-json"],
    ["oversize input", " ".repeat(3_000_001), "source-oversize"],
  ])("refuses %s", (_, raw, code) => {
    expect(() => adaptCRTContributorship(raw)).toThrow(code);
  });
});

describe("ORCID roster: candidate contacts and credit claims only", () => {
  const result = adaptOrcidRoster(rawRoster);

  it("agrees with the producer's own reference reading (candidate_contacts)", () => {
    const byMember = (a: { member_key: string }, b: { member_key: string }) =>
      a.member_key.localeCompare(b.member_key, "en");
    expect(
      result.candidateContacts
        .map((c) => ({
          member_key: c.sourceMemberRef,
          orcid: c.orcid?.id ?? null,
          orcid_status: c.orcid?.nativeStatus ?? null,
          display_name: c.displayName,
          membership_status: c.membership.nativeStatus,
        }))
        .sort(byMember),
    ).toEqual(
      rosterReading.candidates
        .map(({ requires: _requires, ...candidate }: any) => candidate)
        .sort(byMember),
    );
    expect(
      result.candidateCreditClaims
        .map((c) => ({
          member_key: c.sourceMemberRef,
          output_key: c.output.sourceOutputRef,
          credit_role: c.role?.slug,
          status: c.sourceStatus,
          confirmed_by_import: c.confirmedByImport,
        }))
        .sort(byMember),
    ).toEqual([...rosterReading.credit_claims].sort(byMember));
    expect(result.sourceDocument).toMatchObject({ digest: { value: rosterReading.digest } });
  });

  it("keeps ORCID status and assertion provenance, output DOI and rights", () => {
    const a = result.candidateContacts.find((c) => c.sourceMemberRef === "m-a")!;
    expect(a.orcid).toEqual({
      id: "0000-0002-1825-0097",
      uri: "https://orcid.org/0000-0002-1825-0097",
      nativeStatus: "claimed",
      assertion: {
        basis: "owner-curated",
        method: "curator-entry",
        assertedAt: "2026-09-01T09:01:00Z",
        assertedBy: "m-a",
        evidence: { sourceRecordVersion: null, reference: null },
      },
    });
    expect(a.personAssertion.evidence.sourceRecordVersion).toBe("2026-08-30T10:00:00Z");
    const software = result.candidateCreditClaims.find((c) => c.role?.slug === "software")!;
    expect(software.output).toMatchObject({
      sourceOutputRef: "o-1",
      doi: "10.5555/roster-demo-1",
      doiIsExample: true,
      sourceRights: "public-orcid-record",
    });
    expect(software.assertion.evidence.reference).toContain("#author-contributions");
    expect(result.report.omittedSourceFields).toContain("orcid.outputs.without-credit-claims");
    expect(JSON.stringify(result)).not.toContain("Synthetic demo working group");
  });

  it("never turns a contact into a role, grant or confirmed contribution", () => {
    expect(result.assertions).toEqual([]);
    expect(result.evidence).toEqual([]);
    expect(
      result.candidateContacts.every(
        (c) => c.destinationStatus === "candidate-only" && c.accessEffect === "none",
      ),
    ).toBe(true);
    expect(result.candidateContacts.every((c) => !("role" in c))).toBe(true);
    expect(result.candidateCreditClaims.every((c) => c.confirmedByImport === false)).toBe(true);
  });

  it("uses collision-free ids for keys that contain colons", () => {
    const roster = mutateRoster((doc) => {
      doc.members = [
        { ...structuredClone(doc.members[2]), member_key: "x:y" },
        { ...structuredClone(doc.members[2]), member_key: "x" },
      ];
      doc.outputs = [
        { ...structuredClone(doc.outputs[1]), output_key: "z" },
        { ...structuredClone(doc.outputs[1]), output_key: "y:z" },
      ];
      const credit = { ...structuredClone(doc.contributions[0]), credit_role: "software" };
      doc.contributions = [
        { ...credit, member_key: "x:y", output_key: "z" },
        { ...credit, member_key: "x", output_key: "y:z" },
      ];
    });
    const ids = adaptOrcidRoster(roster).candidateCreditClaims.map((c) => c.observationId);
    expect(new Set(ids).size).toBe(2);
  });

  it("is invariant to record and redaction-list order", () => {
    const permuted = adaptOrcidRoster(
      mutateRoster((doc) => {
        doc.members.reverse();
        doc.outputs.reverse();
        doc.contributions.reverse();
        doc.redaction.excluded_outputs.reverse();
      }),
    );
    // The roster's own digest covers array order, so it legitimately changes too.
    expect(permuted.sourceDocument).toMatchObject({ digest: { algorithm: "sha256" } });
    sameExceptSourceBytes({ ...permuted, sourceDocument: result.sourceDocument }, result);
  });
});

describe("ORCID roster frozen privacy and consent rules", () => {
  it.each([
    [
      "an unselected ORCID",
      (d: any) => (d.redaction.member_fields = []),
      "roster-redaction-contradiction",
    ],
    [
      "an unselected display name",
      (d: any) => (d.members[0].display_name = "Dana"),
      "roster-redaction-contradiction",
    ],
    [
      "an unselected local role",
      (d: any) => (d.members[0].local_role = "PI"),
      "roster-redaction-contradiction",
    ],
    [
      "an offline OAuth-verified iD",
      (d: any) => (d.members[0].orcid.status = "oauth-verified"),
      "roster-elevated-identity-claim",
    ],
    [
      "offline externally verified ORCID evidence",
      (d: any) => (d.members[0].orcid.assertion.basis = "external-verified"),
      "roster-elevated-identity-claim",
    ],
    [
      "offline externally verified output",
      (d: any) => (d.outputs[0].assertion.basis = "external-verified"),
      "roster-elevated-identity-claim",
    ],
    [
      "offline accepted invitation",
      (d: any) => (d.members[0].membership.status = "verified-invitation-accepted"),
      "roster-elevated-identity-claim",
    ],
    [
      "a duplicate ORCID",
      (d: any) => (d.members[1].orcid = structuredClone(d.members[0].orcid)),
      "duplicate-roster-orcid",
    ],
    [
      "a mismatched ORCID URI",
      (d: any) => (d.members[0].orcid.uri = "https://orcid.org/0000-0001-5109-3700"),
      "source-identity-invalid",
    ],
    [
      "a checksum-invalid ORCID",
      (d: any) => {
        d.members[0].orcid.id = "0000-0002-1825-0098";
        d.members[0].orcid.uri = "https://orcid.org/0000-0002-1825-0098";
      },
      "source-identity-invalid",
    ],
    [
      "consent by a non-creator",
      (d: any) => (d.consent.granted_by = "m-b"),
      "roster-consent-invalid",
    ],
    [
      "granted consent with a revocation time",
      (d: any) => (d.consent.revoked_at = "2026-10-02T00:00:00Z"),
      "roster-consent-invalid",
    ],
    [
      "a source-declared role without reference",
      (d: any) => (d.contributions[1].assertion.evidence.reference = null),
      "roster-contribution-provenance-missing",
    ],
    [
      "a curator-confirmed role without curator",
      (d: any) => (d.contributions[0].assertion.asserted_by = null),
      "roster-contribution-provenance-missing",
    ],
    [
      "project references marked omitted",
      (d: any) => d.project_references.push(projectReference()),
      "roster-redaction-contradiction",
    ],
    [
      "a project URL without sharing approval",
      (d: any) => {
        d.redaction.project_references = "included";
        d.project_references.push({ ...projectReference(), url: "https://example.org/p" });
      },
      "roster-redaction-contradiction",
    ],
    [
      "a dangling contribution",
      (d: any) => (d.contributions[0].output_key = "o-9"),
      "roster-contribution-reference-invalid",
    ],
  ])("rejects %s", (_, apply, code) => {
    expect(() => adaptOrcidRoster(mutateRoster(apply))).toThrow(code);
  });

  it("rejects revoked consent that still carries members or only project references", () => {
    const revoke = (d: any) => {
      d.consent.status = "revoked";
      d.consent.revoked_at = "2026-10-02T00:00:00Z";
    };
    expect(() => adaptOrcidRoster(mutateRoster(revoke))).toThrow("roster-revoked-data-present");
    const onlyProjects = mutateRoster((d) => {
      revoke(d);
      d.members = [];
      d.outputs = [];
      d.contributions = [];
      d.redaction.project_references = "included";
      d.project_references = [projectReference()];
    });
    expect(() => adaptOrcidRoster(onlyProjects)).toThrow("roster-revoked-data-present");
    const clean = adaptOrcidRoster(
      mutateRoster((d) => {
        revoke(d);
        d.members = [];
        d.outputs = [];
        d.contributions = [];
      }),
    );
    expect(clean.report.accepted).toBe(0);
    expect(clean.report.reasonCodes).toEqual(["roster-consent-revoked"]);
  });

  it("accepts a selected display name and an externally evidenced OAuth iD only from an external platform", () => {
    const external = (reference: string | null) =>
      mutateRoster((d) => {
        d.origin = "external-platform";
        d.redaction.member_fields = ["display_name", "orcid"];
        d.members[0].display_name = "Synthetic Member A";
        d.members[0].orcid.status = "oauth-verified";
        d.members[0].orcid.assertion.basis = "external-verified";
        d.members[0].orcid.assertion.evidence.reference = reference;
      });
    expect(() => adaptOrcidRoster(external(null))).toThrow("roster-verification-evidence-missing");
    const accepted = adaptOrcidRoster(external("orcid-oauth:synthetic-a"));
    const a = accepted.candidateContacts.find((c) => c.sourceMemberRef === "m-a")!;
    expect(a).toMatchObject({
      displayName: "Synthetic Member A",
      destinationStatus: "candidate-only",
    });
    expect(a.orcid?.nativeStatus).toBe("oauth-verified");
    expect(accepted.accountVerification).toBe("not-performed");
  });

  it.each([
    ["a changed byte", (d: any) => (d.group.name = "tampered"), false, "roster-digest-mismatch"],
    [
      "an invented grant",
      (d: any) => (d.access_effect.grants = "project-admin"),
      true,
      "source-schema-incompatible",
    ],
    [
      "a newer version",
      (d: any) => (d.schema_version = "0.2.0"),
      true,
      "source-schema-incompatible",
    ],
    [
      "an undeclared field",
      (d: any) => (d.members[0].email = "x"),
      true,
      "source-schema-incompatible",
    ],
  ])("rejects %s", (_, apply, rehash, code) => {
    const raw = rehash ? mutateRoster(apply) : mutate(rawRoster, apply);
    expect(() => adaptOrcidRoster(raw)).toThrow(code);
  });

  it.each([
    ["invalid JSON", "{", "source-invalid-json"],
    ["a JSON number", "7", "source-invalid-json"],
    ["oversize input", " ".repeat(3_000_001), "source-oversize"],
  ])("refuses %s", (_, raw, code) => {
    expect(() => adaptOrcidRoster(raw)).toThrow(code);
  });
});

function projectReference() {
  return {
    provider: "synthetic",
    identifier: "project-1",
    status: "proposed",
    declared_visibility: "private",
    sharing_approved: false,
    url: null,
    assertion: {
      basis: "owner-curated",
      method: "curator-entry",
      asserted_at: "2026-09-01T09:00:00Z",
      asserted_by: "m-a",
      evidence: { source_record_version: null, reference: null },
    },
  };
}

describe("deterministic CRediT role normalization", () => {
  it.each([
    ["Data curation", "data-curation"],
    ["data  curation ", "data-curation"],
    ["data-curation", "data-curation"],
    ["Writing – original draft", "writing-original-draft"],
    ["Writing - review & editing", "writing-review-editing"],
    ["Conceptualization", "conceptualization"],
  ])("maps %j to %s", (label, slug) => {
    expect(mapCreditRole(label)).toBe(slug);
  });

  it.each(["Lead author", "Writing", "data_curation", "Curation of data", "Statistics", ""])(
    "never infers a role from %j",
    (label) => {
      expect(mapCreditRole(label)).toBeNull();
    },
  );
});

describe("no credit leaks through adapter exceptions", () => {
  const identities = [
    ...new Set<string>([
      ...JSON.parse(rawCRT).contributors.flatMap((c: any) =>
        [c.display_name, c.orcid?.id].filter(Boolean),
      ),
      ...contributions(JSON.parse(rawDiggy))
        .flatMap((c: any) => [c.contributor.display_name, c.contributor.orcid?.id])
        .filter(Boolean),
      ...JSON.parse(rawRoster).members.flatMap((m: any) => (m.orcid ? [m.orcid.id] : [])),
    ]),
  ];

  it("emits only stable codes for every failure path", () => {
    expect(identities.length).toBeGreaterThan(4);
    const attempts: (() => unknown)[] = [
      () => adaptDiggypaperCredit("{not json", diggyPacket()),
      () =>
        adaptDiggypaperCredit(
          mutate(rawDiggy, (d) => (d.entries[0].binding.paper_id = 7)),
          diggyPacket(),
        ),
      () =>
        adaptDiggypaperCredit(
          mutate(rawDiggy, (d) => (firstNamed(d).status = "withheld")),
          diggyPacket(),
        ),
      () =>
        adaptDiggypaperCredit(
          mutate(rawDiggy, (d) => (firstNamed(d).contributor.orcid.id = "0000-0002-1825-0098")),
          diggyPacket(),
        ),
      () => adaptCRTContributorship(mutate(rawCRT, (d) => (d.contributors[0].orcid = 7))),
      () =>
        adaptCRTContributorship(
          mutate(rawCRT, (d) => (d.contributors[1].orcid.id = "0000-0000-0000-0010")),
        ),
      () => adaptCRTContributorship(rawCRT, "{}"),
      () => adaptOrcidRoster(mutate(rawRoster, (d) => (d.group.name = "x"))),
      () => adaptOrcidRoster(mutateRoster((d) => (d.redaction.member_fields = []))),
      () =>
        adaptOrcidRoster(
          mutateRoster((d) => (d.members[1].orcid = structuredClone(d.members[0].orcid))),
        ),
    ];
    for (const attempt of attempts) {
      try {
        attempt();
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(SourceCreditAdapterError);
        const text = String((error as Error).message) + JSON.stringify(error);
        expect((error as Error).message).toMatch(/^[a-z0-9-]+$/u);
        for (const identity of identities) expect(text).not.toContain(identity);
      }
    }
  });
});
