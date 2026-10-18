import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { sourceCreditObservationsSchema } from "@oratlas/contracts";
import { adaptDiggypaperCredit } from "./source-credit-diggypaper.js";
import { adaptCRTContributorship } from "./source-credit-crt.js";
import { adaptOrcidRoster } from "./source-credit-orcid.js";

const fixture = (file: string): string =>
  readFileSync(new URL("./fixtures/source-credit-interop/" + file, import.meta.url), "utf8");
const rawDiggy = fixture("diggypaper/credit.json");
const rawCRT = fixture("crt/credit.json");
const rawRoster = fixture("orcid/roster.json");
const diggyPacket = () => ({
  manifest: fixture("diggypaper/packet/manifest.json"),
  papers: fixture("diggypaper/packet/papers.jsonl"),
  findings: fixture("diggypaper/packet/findings.jsonl"),
  passages: fixture("diggypaper/packet/passages.jsonl"),
  assessments: fixture("diggypaper/packet/assessments.jsonl"),
});

const mutate = (raw: string, apply: (data: Record<string, any>) => void): string => {
  const data = JSON.parse(raw) as Record<string, any>;
  apply(data);
  return JSON.stringify(data);
};

describe("pinned source-native contract fixtures: merge commit byte snapshots", () => {
  it.each([
    ["diggypaper", "diggypaper.schema.json", rawDiggy],
    ["CRT", "crt.private.schema.json", rawCRT],
    ["ORCID roster", "orcid.roster.schema.json", rawRoster],
  ])("validates %s fixture against the exact frozen producer JSON Schema", (_, path, raw) => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const schema = JSON.parse(fixture("schemas/" + path));
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
    const x = adaptCRTContributorship(rawCRT, fixture("crt/claim-graph.json"));
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

    const forgedOAuth = mutate(rawRoster, (doc) => {
      doc.members[0].orcid.status = "oauth-verified";
      // Recalculate is intentionally not performed: mutation invalidates signed digest.
    });
    expect(() => adaptOrcidRoster(forgedOAuth)).toThrow("roster-digest-mismatch");

    const revoked = mutate(rawRoster, (doc) => {
      doc.consent.status = "revoked";
    });
    expect(() => adaptOrcidRoster(revoked)).toThrow("roster-digest-mismatch");
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
