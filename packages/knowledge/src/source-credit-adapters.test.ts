/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic upstream payloads are mutated to test fail-closed behavior */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { canonicalJson, sourceCreditObservationsSchema } from "@oratlas/contracts";
import { adaptDiggypaperCredit } from "./source-credit-diggypaper.js";
import { adaptCRTContributorship } from "./source-credit-crt.js";
import { adaptOrcidRoster } from "./source-credit-orcid.js";
import { SourceCreditAdapterError, mapCreditRole } from "./source-credit-adapter-shared.js";

const rawDiggy = readFileSync(
  new URL("./fixtures/source-credit-interop/diggypaper/credit.json", import.meta.url),
  "utf8",
);
const rawCRT = readFileSync(
  new URL("./fixtures/source-credit-interop/crt/credit.json", import.meta.url),
  "utf8",
);
const rawRoster = readFileSync(
  new URL("./fixtures/source-credit-interop/orcid/roster.json", import.meta.url),
  "utf8",
);
const nativeDiggy = readFileSync(
  new URL("./fixtures/source-credit-interop/schemas/diggypaper.schema.json", import.meta.url),
  "utf8",
);
const nativeCRT = readFileSync(
  new URL("./fixtures/source-credit-interop/schemas/crt.private.schema.json", import.meta.url),
  "utf8",
);
const nativeRoster = readFileSync(
  new URL("./fixtures/source-credit-interop/schemas/orcid.roster.schema.json", import.meta.url),
  "utf8",
);
const packetManifest = readFileSync(
  new URL("./fixtures/source-credit-interop/diggypaper/packet/manifest.json", import.meta.url),
  "utf8",
);
const packetPapers = readFileSync(
  new URL("./fixtures/source-credit-interop/diggypaper/packet/papers.jsonl", import.meta.url),
  "utf8",
);
const packetFindings = readFileSync(
  new URL("./fixtures/source-credit-interop/diggypaper/packet/findings.jsonl", import.meta.url),
  "utf8",
);
const packetPassages = readFileSync(
  new URL("./fixtures/source-credit-interop/diggypaper/packet/passages.jsonl", import.meta.url),
  "utf8",
);
const packetAssessments = readFileSync(
  new URL("./fixtures/source-credit-interop/diggypaper/packet/assessments.jsonl", import.meta.url),
  "utf8",
);
const rawCRTGraph = readFileSync(
  new URL("./fixtures/source-credit-interop/crt/claim-graph.json", import.meta.url),
  "utf8",
);
const rehashRoster = (data: Record<string, any>): void => {
  const { digest: _oldDigest, ...payload } = data;
  data.digest.value = createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
};
const diggyPacket = () => ({
  manifest: packetManifest,
  papers: packetPapers,
  findings: packetFindings,
  passages: packetPassages,
  assessments: packetAssessments,
});

const mutate = (raw: string, apply: (data: Record<string, any>) => void): string => {
  const data = JSON.parse(raw) as Record<string, any>;
  apply(data);
  return JSON.stringify(data);
};

describe("pinned source-native contract fixtures: merge commit byte snapshots", () => {
  it.each([
    ["diggypaper", nativeDiggy, rawDiggy],
    ["CRT", nativeCRT, rawCRT],
    ["ORCID roster", nativeRoster, rawRoster],
  ])("validates %s fixture against the exact frozen producer JSON Schema", (_, schemaText, raw) => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const schema = JSON.parse(schemaText);
    const validate = ajv.compile(schema);
    const valid = validate(JSON.parse(raw));
    expect(valid, JSON.stringify(validate.errors)).toBe(true);
  });
});

describe("Diggypaper source finding credit: separate credit, paper and evidence", () => {
  it("preserves independent finding revisions, passages, assessor pseudonyms and native statuses", () => {
    const result = adaptDiggypaperCredit(rawDiggy, diggyPacket());
    expect(sourceCreditObservationsSchema.parse(result)).toEqual(result);
    expect(result.producer).toBe("diggypaper");
    expect(result.accessEffect).toBe("none");
    expect(result.visibility).toBe("private-adapter-output");
    expect(result.evidence.length).toBeGreaterThanOrEqual(2);
    expect(new Set(result.evidence.map((f) => f.target.sourceId)).size).toBe(
      result.evidence.length,
    );
    expect(result.evidence[0]?.target.packetManifestSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.evidence.some((e) => e.originalPaperAuthors.length > 0)).toBe(true);
    expect(result.evidence.every((e) => e.nativeOriginId === "packet:credit-synthetic")).toBe(true);
    expect(result.evidence.every((e) => e.nativeVisibility === "project-members")).toBe(true);
    expect(result.assertions.some((c) => c.person.kind === "pseudonym")).toBe(true);
    expect(result.assertions.some((c) => c.person.kind === "withheld")).toBe(true);
    expect(result.assertions.some((c) => c.role?.slug === "data-curation")).toBe(true);
    expect(result.assertions.every((c) => c.destinationStatus === "not-adjudicated")).toBe(true);
    expect(result.assertions.every((c) => c.oratlasDisclosure === "not-authorized")).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("ownerSubjectId");
    expect(serialized).not.toContain("projectId");
  });

  it("does not invent an identity when a source pseudonym or withheld contributor lacks a display name", () => {
    const result = adaptDiggypaperCredit(rawDiggy, diggyPacket());
    for (const a of result.assertions.filter((r) => r.person.kind !== "named")) {
      expect(a.person).not.toHaveProperty("displayName");
      expect(a.person).not.toHaveProperty("orcid");
    }
    const reviewed = result.assertions.find((a) => a.sourceStatus === "confirmed");
    expect(reviewed).toBeDefined();
    expect(reviewed?.destinationStatus).toBe("not-adjudicated");
  });

  it("refuses changed packet bytes, falsely bound source revisions and duplicated entries", () => {
    const bad = diggyPacket();
    bad.passages = bad.passages.replace("sha256:", "sha256:0");
    expect(() => adaptDiggypaperCredit(rawDiggy, bad)).toThrow("packet-artifact-digest-mismatch");

    const revision = mutate(rawDiggy, (data) => {
      data.entries[0].binding.finding_revision = 100;
    });
    expect(() => adaptDiggypaperCredit(revision, diggyPacket())).toThrow(
      "finding-revision-or-packet-invalid",
    );

    const duplicate = mutate(rawDiggy, (data) => {
      data.entries.push(structuredClone(data.entries[0]));
    });
    expect(() => adaptDiggypaperCredit(duplicate, diggyPacket())).toThrow("duplicate-credit-entry");
  });

  it("has a permutation-invariant normalized projection while retaining the actual raw document hash", () => {
    const a = adaptDiggypaperCredit(rawDiggy, diggyPacket());
    const b = adaptDiggypaperCredit(
      mutate(rawDiggy, (data) => {
        data.entries.reverse();
        for (const entry of data.entries) entry.contributions.reverse();
      }),
      diggyPacket(),
    );
    expect({ ...b, sourceDocumentSha256: a.sourceDocumentSha256 }).toEqual(a);
  });
});

describe("CRT source-native credit and review evidence", () => {
  it("keeps claimed and verified identities, bibliographic citation credit and AI agents separate", () => {
    const x = adaptCRTContributorship(rawCRT, rawCRTGraph);
    expect(sourceCreditObservationsSchema.parse(x)).toEqual(x);
    expect(x.producer).toBe("computational-review-template");
    expect(x.assertions.some((a) => a.sourceStatus === "confirmed")).toBe(true);
    expect(x.assertions.every((a) => a.destinationStatus === "not-adjudicated")).toBe(true);
    expect(
      x.assertions.some(
        (a) => a.person.kind === "named" && a.person.sourceOrcidStatus === "source-verified",
      ),
    ).toBe(true);
    expect(x.production.length).toBeGreaterThanOrEqual(1);
    expect(x.evidence.length).toBeGreaterThanOrEqual(2);
    expect(x.evidence.some((e) => e.originalPaperAuthors.length > 0)).toBe(true);
    expect(x.evidence.every((e) => e.nativeOriginId.startsWith("origin-"))).toBe(true);
    expect(x.evidence.every((e) => e.target.lineageSha256?.startsWith("sha256:"))).toBe(true);
    expect(x.production.every((p) => p.actorKind === "software")).toBe(true);
    expect(x.assertions.every((a) => a.person.kind !== "pseudonym")).toBe(true);
    expect(x.report.reasonCodes).toContain("crt-relation-proposals-not-authoritative");
  });

  it("rejects a finding duplicated across packets regardless of order", () => {
    const duplicated = mutate(rawCRT, (doc) => {
      const original = doc.source_credit[0].findings[0];
      doc.source_credit[0].findings.push({
        ...original,
        packet: { ...original.packet, packet_id: "packet:crt17-beta" },
        origin_id: "origin-beta",
      });
    });
    expect(() => adaptCRTContributorship(duplicated)).toThrow("crt-duplicate-finding");
    const swapped = mutate(duplicated, (doc) => doc.source_credit[0].findings.reverse());
    expect(() => adaptCRTContributorship(swapped)).toThrow("crt-duplicate-finding");
  });

  it("refuses forged source-verified ORCIDs, missing status references, and claim graph drift", () => {
    const noEvidence = mutate(rawCRT, (doc) => {
      const verified = doc.contributors.find((x: any) => x.orcid?.status === "verified");
      delete verified.orcid.verification;
    });
    expect(() => adaptCRTContributorship(noEvidence)).toThrow("crt-orcid-evidence-missing");
    const noDecision = mutate(rawCRT, (doc) => {
      const confirmed = doc.credit_assertions.find((x: any) => x.status === "confirmed");
      confirmed.status_ref = null;
    });
    expect(() => adaptCRTContributorship(noDecision)).toThrow("crt-status-decision-invalid");
    expect(() => adaptCRTContributorship(rawCRT, "{}\n")).toThrow("claim-graph-sha256-mismatch");
  });

  it("does not turn the same-paper candidate or native relation proposal into authoritative knowledge", () => {
    const x = adaptCRTContributorship(rawCRT);
    expect(x.report.reasonCodes).toContain("crt-relation-proposals-not-authoritative");
    expect(x.report.reasonCodes).toContain("claim-graph-bytes-not-supplied");
    expect(x.evidence.every((e) => e.sourceStatus.startsWith("reviewed-mapping:"))).toBe(true);
  });
});

describe("ORCID roster candidate-only import", () => {
  it("checks canonical source digest and returns zero grants, no cross-project credit or verified accounts", () => {
    const x = adaptOrcidRoster(rawRoster);
    expect(sourceCreditObservationsSchema.parse(x)).toEqual(x);
    expect(x.producer).toBe("orcid-playground");
    expect(x.accessEffect).toBe("none");
    expect(x.assertions).toEqual([]);
    expect(x.evidence).toEqual([]);
    expect(x.candidateContacts.length).toBeGreaterThan(0);
    expect(
      x.candidateContacts.every(
        (c) => c.destinationStatus === "candidate-only" && c.accessEffect === "none",
      ),
    ).toBe(true);
    expect(x.candidateContacts.some((c) => c.role?.slug === "conceptualization")).toBe(true);
    expect(x.accountVerification).toBe("not-performed");
    expect(JSON.stringify(x)).not.toContain("verified-invitation-accepted");
  });

  it("fails closed on a changed roster byte, invented access effect, elevated local ORCID and revived consent", () => {
    const wrong = mutate(rawRoster, (doc) => {
      doc.group.name = "tampered";
    });
    expect(() => adaptOrcidRoster(wrong)).toThrow("roster-digest-mismatch");

    const grant = mutate(rawRoster, (doc) => {
      doc.access_effect.grants = "project-admin";
    });
    expect(() => adaptOrcidRoster(grant)).toThrow("source-schema-incompatible");

    const forgedVerifiedStatus = mutate(rawRoster, (doc) => {
      doc.members[0].orcid.status = "oauth-verified";
      rehashRoster(doc);
    });
    expect(() => adaptOrcidRoster(forgedVerifiedStatus)).toThrow("roster-elevated-identity-claim");

    const revoked = mutate(rawRoster, (doc) => {
      doc.consent.status = "revoked";
      rehashRoster(doc);
    });
    expect(() => adaptOrcidRoster(revoked)).toThrow("roster-revoked-data-present");
  });

  it("does not conflate local group roles and credited output roles", () => {
    const x = adaptOrcidRoster(rawRoster);
    expect(x.candidateContacts.some((c) => c.sourceOutputRef === null && c.role === null)).toBe(
      true,
    );
    expect(
      x.candidateContacts.filter((c) => c.sourceOutputRef !== null).every((c) => c.role !== null),
    ).toBe(true);
    expect(JSON.stringify(x)).not.toContain("ownerSubjectId");
    expect(JSON.stringify(x)).not.toContain("projectId");
  });
});

const firstNamed = (doc: Record<string, any>) =>
  doc.entries
    .flatMap((entry: any) => entry.contributions)
    .find((c: any) => c.contributor.kind === "disclosed");

describe("deterministic CRediT role normalization", () => {
  it.each([
    ["Data curation", "data-curation"],
    ["data  curation ", "data-curation"],
    ["data-curation", "data-curation"],
    ["Writing \u2013 original draft", "writing-original-draft"],
    ["Writing - review & editing", "writing-review-editing"],
    ["Conceptualization", "conceptualization"],
  ])("maps %j to %s", (label, slug) => {
    expect(mapCreditRole(label)).toBe(slug);
  });

  it.each(["Lead author", "Writing", "data_curation", "Curation of data", ""])(
    "never infers a role from %j",
    (label) => {
      expect(mapCreditRole(label)).toBeNull();
    },
  );

  it("reports an unrecognized Diggypaper label as unmappable without assigning a role", () => {
    const raw = mutate(rawDiggy, (doc) => {
      firstNamed(doc).credit_roles = [{ ...firstNamed(doc).credit_roles[0], role: "Lead author" }];
    });
    const result = adaptDiggypaperCredit(raw, diggyPacket());
    expect(result.report.unmappable).toBe(1);
    expect(result.report.reasonCodes).toContain("unmapped-credit-role");
    expect(
      result.assertions.filter((a) => a.role === null && a.capacity !== undefined),
    ).not.toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('"originalLabel":"Lead author"');
  });

  it("preserves the original Diggypaper label, degree and declaration ref beside the slug", () => {
    const result = adaptDiggypaperCredit(rawDiggy, diggyPacket());
    const curated = result.assertions.find((a) => a.role?.slug === "data-curation");
    expect(curated?.role?.originalLabel).toBe("Data curation");
    expect(curated?.role?.declarationRef).toBeTruthy();
  });
});

describe("Diggypaper identity safety", () => {
  it.each(["withheld", "withdrawn"])(
    "never emits a name for a %s credit even when the contributor object is disclosed",
    (status) => {
      const target = firstNamed(JSON.parse(rawDiggy));
      const name: string = target.contributor.display_name;
      const raw = mutate(rawDiggy, (doc) => {
        firstNamed(doc).status = status;
      });
      const result = adaptDiggypaperCredit(raw, diggyPacket());
      expect(JSON.stringify(result)).not.toContain(name);
      expect(result.report.withheld).toBeGreaterThan(0);
    },
  );

  it("fails closed, without a name in the error, when a blinded reviewer is disclosed", () => {
    const name: string = firstNamed(JSON.parse(rawDiggy)).contributor.display_name;
    const raw = mutate(rawDiggy, (doc) => {
      firstNamed(doc).review_blinding = "blinded";
    });
    try {
      adaptDiggypaperCredit(raw, diggyPacket());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SourceCreditAdapterError);
      expect((error as Error).message).toBe("disclosure-not-authorized");
      expect(JSON.stringify(error)).not.toContain(name);
    }
  });

  it("fails closed when person consent is not granted", () => {
    const raw = mutate(rawDiggy, (doc) => {
      firstNamed(doc).disclosure.person_consent = "revoked";
    });
    expect(() => adaptDiggypaperCredit(raw, diggyPacket())).toThrow("disclosure-not-authorized");
  });

  it("flags a source-confirmed credit lacking a decision ref instead of synthesizing one", () => {
    const raw = mutate(rawDiggy, (doc) => {
      const confirmed = doc.entries
        .flatMap((e: any) => e.contributions)
        .find((c: any) => c.status === "confirmed");
      confirmed.disclosure.consent_ref = "not-available";
    });
    const result = adaptDiggypaperCredit(raw, diggyPacket());
    expect(result.report.reasonCodes).toContain("source-confirmed-without-decision-ref");
    expect(result.assertions.every((a) => a.destinationStatus === "not-adjudicated")).toBe(true);
  });

  it("rejects a changed manifest byte as a packet binding failure", () => {
    const bad = { ...diggyPacket(), manifest: packetManifest.replace(/\n$/u, " \n") };
    expect(() => adaptDiggypaperCredit(rawDiggy, bad)).toThrow("packet-manifest-binding-mismatch");
  });
});

describe("normative-byte bindings and order invariance for CRT and the roster", () => {
  it("rejects a single changed claim-graph byte, not only an unrelated document", () => {
    const flipped = rawCRTGraph.replace(/\n?$/u, " \n");
    expect(() => adaptCRTContributorship(rawCRT, flipped)).toThrow("claim-graph-sha256-mismatch");
    expect(() => adaptCRTContributorship(rawCRT, rawCRTGraph)).not.toThrow();
  });

  it("normalizes CRT identically regardless of record order", () => {
    const a = adaptCRTContributorship(rawCRT, rawCRTGraph);
    const b = adaptCRTContributorship(
      mutate(rawCRT, (doc) => {
        doc.contributors.reverse();
        doc.credit_assertions.reverse();
        doc.source_origins.reverse();
        doc.source_credit.reverse();
        for (const record of doc.source_credit) record.findings.reverse();
        doc.production.agent_runs.reverse();
      }),
      rawCRTGraph,
    );
    expect({ ...b, sourceDocumentSha256: a.sourceDocumentSha256 }).toEqual(a);
  });

  it("rejects the same finding listed twice for one claim", () => {
    const raw = mutate(rawCRT, (doc) => {
      const findings = doc.source_credit[0].findings;
      findings.push(structuredClone(findings[0]));
    });
    expect(() => adaptCRTContributorship(raw)).toThrow("crt-duplicate-finding");
  });

  it("normalizes the roster identically regardless of record order", () => {
    const a = adaptOrcidRoster(rawRoster);
    const b = adaptOrcidRoster(
      mutate(rawRoster, (doc) => {
        doc.members.reverse();
        doc.outputs.reverse();
        doc.contributions.reverse();
        rehashRoster(doc);
      }),
    );
    expect({ ...b, sourceDocumentSha256: a.sourceDocumentSha256 }).toEqual(a);
  });

  it("rejects duplicate roster contributions", () => {
    const raw = mutate(rawRoster, (doc) => {
      doc.contributions.push(structuredClone(doc.contributions[0]));
      rehashRoster(doc);
    });
    expect(() => adaptOrcidRoster(raw)).toThrow("duplicate-roster-contribution");
  });
});

describe("no credit leaks through adapter exceptions", () => {
  const names = [
    ...new Set<string>([
      ...JSON.parse(rawCRT).contributors.map((c: any) => c.display_name),
      ...JSON.parse(rawDiggy)
        .entries.flatMap((e: any) => e.contributions)
        .map((c: any) => c.contributor.display_name)
        .filter(Boolean),
    ]),
  ];

  it("emits only stable codes for every failure path", () => {
    expect(names.length).toBeGreaterThan(0);
    const attempts: (() => unknown)[] = [
      () => adaptDiggypaperCredit("{not json", diggyPacket()),
      () =>
        adaptDiggypaperCredit(
          mutate(rawDiggy, (d) => (d.entries[0].binding.paper_id = 7)),
          diggyPacket(),
        ),
      () => adaptCRTContributorship(mutate(rawCRT, (d) => (d.contributors[0].orcid = 7))),
      () => adaptCRTContributorship(rawCRT, "{}"),
      () => adaptOrcidRoster(mutate(rawRoster, (d) => (d.group.name = "x"))),
    ];
    for (const attempt of attempts) {
      try {
        attempt();
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(SourceCreditAdapterError);
        const text = String((error as Error).message) + JSON.stringify(error);
        expect(text).toMatch(/^[a-z0-9-]+/u);
        for (const name of names) expect(text).not.toContain(name);
      }
    }
  });
});
