import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  connectorProjectDescriptorSchema,
  researchProjectDescriptorSchema,
} from "@oratlas/contracts";
import {
  adaptCRTProjectDescriptor,
  adaptDiggypaperProjectDescriptor,
  connectorArtifactIdentity,
  researchArtifactIdentity,
  CRT_PROJECT_DESCRIPTOR_PIN,
  DIGGYPAPER_PROJECT_DESCRIPTOR_PIN,
  MAX_PROJECT_DESCRIPTOR_BYTES,
} from "./research-project-descriptors.js";

const base = new URL("./fixtures/research-project-descriptors/", import.meta.url);
const bytes = (name: string) => readFileSync(new URL(name, base));
const json = (name: string) => JSON.parse(bytes(name).toString("utf8"));
const sha = (raw: Uint8Array) => "sha256:" + createHash("sha256").update(raw).digest("hex");
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const native = () => json("crt/descriptor.private.json");
function adapt(value = native()) {
  const raw = encode(value);
  return adaptCRTProjectDescriptor(raw, sha(raw));
}

describe("private research-project descriptor observations (#206)", () => {
  it("pins authentic producer bytes and schema without executing producer runtime", () => {
    const pins = json("pins.json");
    expect(pins.commit).toBe(CRT_PROJECT_DESCRIPTOR_PIN);
    for (const [path, digest] of Object.entries(pins.files))
      expect(sha(bytes(path)), path).toBe(digest);
    const validate = new Ajv2020({ strict: true }).compile(json("crt/manifest.schema.json"));
    expect(validate(native()), JSON.stringify(validate.errors)).toBe(true);
    const held = native();
    for (const artifact of held.artifacts) {
      const content = bytes("crt/" + artifact.path.split("/").at(-1));
      expect(content.byteLength).toBe(artifact.bytes);
      expect(sha(content)).toBe("sha256:" + artifact.sha256);
    }
    const raw = bytes("crt/descriptor.private.json");
    expect(adaptCRTProjectDescriptor(raw, sha(raw))).toEqual(json("crt/expected.private.json"));
  });

  it("retains working, reviewed and released states while all output remains private and without access", () => {
    const result = adapt();
    expect(result.artifacts.map((item) => item.declaredState)).toEqual([
      "working",
      "reviewed",
      "released",
    ]);
    expect(result.source.declaredVisibility).toBe("private");
    expect(result.visibility).toBe("private-adapter-output");
    expect(result.accessEffect).toBe("none");
    expect(result.principalAuthorization).toBe("not-performed");
    expect(result.sourceVersionVerification).toBe("not-performed");
    for (const artifact of result.artifacts) {
      expect(artifact.artifactByteVerification).toBe("not-performed");
      expect(artifact.crossProjectProcessing).toBe("not-authorized");
    }
    expect(result).not.toHaveProperty("members");
    expect(result).not.toHaveProperty("verified");
    expect(result).not.toHaveProperty("publicRelease");
  });

  it("normalizes artifact order without changing input or exact source-document identity", () => {
    const value = native();
    const before = JSON.stringify(value);
    const first = adapt(value);
    value.artifacts.reverse();
    const second = adapt(value);
    expect(first.artifacts).toEqual(second.artifacts);
    expect(first.sourceDocumentSha256).not.toBe(second.sourceDocumentSha256);
    value.artifacts.reverse();
    expect(JSON.stringify(value)).toBe(before);
    expect(canonicalJson(first)).toBe(canonicalJson(adapt(value)));
  });

  it.each([
    "../..",
    "owner/..",
    "-owner/repo",
    "owner--name/repo",
    "https://token@github.com/owner/repo",
  ])("rejects unsafe source coordinates %s", (repository) => {
    const value = native();
    value.source.repository = repository;
    expect(() => adapt(value)).toThrow("source-incompatible");
  });

  it.each(["token", "orcid", "members", "grants", "accessProof"])(
    "rejects forged identity/permission field %s",
    (key) => {
      const value = native();
      value[key] = "synthetic-secret";
      expect(() => adapt(value)).toThrow(/^source-incompatible$/);
    },
  );

  it.each([
    "version",
    "withdrawal",
    "duplicate-id",
    "duplicate-path",
    "traversal",
    "private-public",
    "rights",
    "release-state",
    "software-author",
  ])("fails closed on %s", (mutation) => {
    const value = native();
    switch (mutation) {
      case "version":
        value.protocol = "research-project-artifacts/999";
        break;
      case "withdrawal":
        value.artifacts[0].clearance = "withdrawn";
        break;
      case "duplicate-id":
        value.artifacts[1].id = value.artifacts[0].id;
        break;
      case "duplicate-path":
        value.artifacts[1].path = value.artifacts[0].path;
        break;
      case "traversal":
        value.artifacts[0].path = "../secret";
        break;
      case "private-public":
        value.artifacts[0].visibility = "public";
        break;
      case "rights":
        value.artifacts[2].rights.redistribution = "unknown";
        break;
      case "release-state":
        value.artifacts[2].state = "reviewed";
        break;
      case "software-author":
        value.artifacts[0].generator = {
          name: "agent",
          version: "1",
          role: "drafting",
          run_id: "run",
          orcid: "claimed",
        };
        break;
    }
    expect(() => adapt(value)).toThrow(/^source-incompatible$/);
  });

  it("rejects changed bytes, oversized/invalid payloads with metadata-free errors", () => {
    const raw = bytes("crt/descriptor.private.json");
    expect(() => adaptCRTProjectDescriptor(null as unknown as Uint8Array, sha(raw))).toThrow(
      /^source-invalid$/,
    );
    expect(() =>
      adaptCRTProjectDescriptor(Buffer.concat([raw, Buffer.from(" ")]), sha(raw)),
    ).toThrow(/^source-digest-mismatch$/);
    expect(() =>
      adaptCRTProjectDescriptor(new Uint8Array(MAX_PROJECT_DESCRIPTOR_BYTES + 1), sha(raw)),
    ).toThrow(/^source-oversize$/);
    for (const invalid of [Buffer.from("not-json secret"), Buffer.from([0xff])]) {
      expect(() => adaptCRTProjectDescriptor(invalid, sha(invalid))).toThrow(/^source-invalid$/);
    }
  });

  it("preserves software and exact credit artifact refs in separate channels without inferred human roles", () => {
    const value = native();
    value.artifacts[0].kind = "contributorship";
    value.artifacts[0].generator = {
      name: "synthetic-agent",
      version: "1",
      role: "drafting",
      run_id: "run-1",
    };
    const result = adapt(value);
    expect(result.creditArtifactIds).toEqual(["draft"]);
    expect(result.artifacts[0]?.generator).toEqual({
      name: "synthetic-agent",
      version: "1",
      role: "drafting",
      runId: "run-1",
    });
    expect(result).not.toHaveProperty("authors");
    expect(result).not.toHaveProperty("creditRoles");
    const changed = structuredClone(result);
    changed.creditArtifactIds = ["missing"];
    expect(researchProjectDescriptorSchema.safeParse(changed).success).toBe(false);
  });

  it("keeps producer/project/version/digest identities distinct", () => {
    const crt = adapt();
    for (const change of [
      (d: typeof crt) => {
        d.project.sourceProjectId += "-other";
      },
      (d: typeof crt) => {
        d.source.declaredCommit = "2".repeat(40);
      },
      (d: typeof crt) => {
        d.artifacts[0]!.sha256 = "sha256:" + "a".repeat(64);
      },
    ]) {
      const different = structuredClone(crt);
      change(different);
      expect(researchArtifactIdentity(different, "draft")).not.toBe(
        researchArtifactIdentity(crt, "draft"),
      );
    }
    expect(() => researchArtifactIdentity(crt, "absent")).toThrow("source-incompatible");
    const malformed = { ...crt, accessEffect: "synthetic-private-secret" } as unknown as typeof crt;
    expect(() => researchArtifactIdentity(malformed, "draft")).toThrow(/^source-incompatible$/);
  });
});

describe("captured Diggypaper connector descriptor (0.2.0, Diggypaper #53)", () => {
  const dg = (name: string) => bytes("diggypaper/" + name);
  const dgNative = () => JSON.parse(dg("descriptor.private.json").toString("utf8"));
  const capture = () => JSON.parse(dg("capture.json").toString("utf8"));
  const asOf = capture().valid_as_of as string;
  const packetFiles = () => {
    const files: Record<string, Uint8Array> = {};
    for (const name of [
      "assessments.jsonl",
      "findings.jsonl",
      "manifest.json",
      "papers.jsonl",
      "passages.jsonl",
    ])
      files[name] = dg("packet/" + name);
    return files;
  };
  const digest = () => dgNative().artifacts[0].digest as string;
  function adaptDg(
    value = dgNative(),
    options: Parameters<typeof adaptDiggypaperProjectDescriptor>[2] = { asOf },
  ) {
    const raw = encode(value);
    return adaptDiggypaperProjectDescriptor(raw, sha(raw), options);
  }

  it("pins the captured producer bytes and schema, and matches the reviewed golden", () => {
    const pins = JSON.parse(dg("pins.json").toString("utf8"));
    expect(pins.commit).toBe(DIGGYPAPER_PROJECT_DESCRIPTOR_PIN);
    expect(pins.data).toBe("synthetic");
    for (const [path, value] of Object.entries(pins.files)) expect(sha(dg(path)), path).toBe(value);
    const schema = JSON.parse(dg("research-project-descriptor.schema.json").toString("utf8"));
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(dgNative()), JSON.stringify(validate.errors)).toBe(true);
    for (const [name, value] of Object.entries(capture().files as Record<string, string>)) {
      const local = name === "descriptor.json" ? "descriptor.private.json" : name;
      expect(sha(dg(local)), name).toBe(value);
    }
    const raw = dg("descriptor.private.json");
    const result = adaptDiggypaperProjectDescriptor(raw, sha(raw), {
      asOf,
      heldPackets: { [digest()]: packetFiles() },
    });
    expect(result).toEqual(JSON.parse(dg("expected.private.json").toString("utf8")));
  });

  it("stays private, grants nothing and keeps withheld metadata withheld", () => {
    const result = adaptDg();
    expect(result.visibility).toBe("private-adapter-output");
    expect(result.accessEffect).toBe("none");
    expect(result.principalAuthorization).toBe("not-performed");
    expect(result.project.title).toEqual({ state: "withheld" });
    expect(result.project.description).toEqual({ state: "withheld" });
    expect(result.artifacts[0]?.artifactByteVerification).toBe("not-performed");
    expect(result.artifacts[0]?.crossProjectProcessing).toBe("not-authorized");
    expect(result.report.reasonCodes).toContain("artifact-bytes-not-verified");
    expect(result).not.toHaveProperty("members");
    expect(result).not.toHaveProperty("grantRef");
    expect(JSON.stringify(result)).not.toContain("grant:");
  });

  it("maps a disclosed title without its decision reference", () => {
    const value = dgNative();
    value.project.title = {
      state: "disclosed",
      value: "Synthetic disclosed title",
      decision_ref: "decision:" + "a".repeat(32),
    };
    expect(adaptDg(value).project.title).toEqual({
      state: "disclosed",
      value: "Synthetic disclosed title",
    });
  });

  it("refuses an expired or not-yet-valid descriptor and an invalid instant", () => {
    const value = dgNative();
    expect(() => adaptDg(value, { asOf: value.expires_at })).toThrow(/^source-expired$/);
    expect(() => adaptDg(value, { asOf: "2026-01-01T00:00:00Z" })).toThrow(/^source-expired$/);
    expect(() => adaptDg(value, { asOf: "tomorrow" })).toThrow(/^source-invalid$/);
  });

  it("refuses a descriptor issued to another recipient", () => {
    const value = dgNative();
    value.audience.recipient_ref = "recipient:someone-else";
    expect(() => adaptDg(value)).toThrow(/^source-audience-mismatch$/);
  });

  it("refuses held packet bytes that do not match the listed digest", () => {
    const tampered = packetFiles();
    tampered["findings.jsonl"] = Buffer.concat([tampered["findings.jsonl"]!, Buffer.from(" ")]);
    expect(() => adaptDg(dgNative(), { asOf, heldPackets: { [digest()]: tampered } })).toThrow(
      /^packet-digest-mismatch$/,
    );
    const missing = packetFiles();
    delete missing["passages.jsonl"];
    expect(() => adaptDg(dgNative(), { asOf, heldPackets: { [digest()]: missing } })).toThrow(
      /^packet-digest-mismatch$/,
    );
    const unlisted = { ["sha256:" + "b".repeat(64)]: packetFiles() };
    expect(() => adaptDg(dgNative(), { asOf, heldPackets: unlisted })).toThrow(
      /^packet-digest-mismatch$/,
    );
  });

  it.each([
    "synthetic-origin",
    "synthetic-commit",
    "no-grant",
    "processing-authorized",
    "admin-holder",
    "public-project",
    "foreign-deep-link",
    "unknown-artifact-type",
    "token",
    "members",
    "orcid",
  ])("fails closed on %s", (mutation) => {
    const value = dgNative();
    switch (mutation) {
      case "synthetic-origin":
        value.creation_method = "synthetic-fixture";
        break;
      case "synthetic-commit":
        value.producer.commit = "synthetic-fixture";
        break;
      case "no-grant":
        value.audience.grant_ref = "not-available";
        break;
      case "processing-authorized":
        value.policy.cross_project_processing = "authorized";
        break;
      case "admin-holder":
        value.holder.role = "admin";
        break;
      case "public-project":
        value.project.visibility = "public";
        break;
      case "foreign-deep-link":
        value.artifacts[0].deep_link = "/projects/00000000-0000-4000-8000-000000000000/findings";
        break;
      case "unknown-artifact-type":
        value.artifacts[0].type = "full-text";
        break;
      default:
        value[mutation] = "synthetic-secret";
    }
    expect(() => adaptDg(value)).toThrow(/^source-incompatible$/);
  });

  it("rejects changed, oversized and invalid bytes with metadata-free errors", () => {
    const raw = dg("descriptor.private.json");
    expect(() =>
      adaptDiggypaperProjectDescriptor(Buffer.concat([raw, Buffer.from(" ")]), sha(raw), { asOf }),
    ).toThrow(/^source-digest-mismatch$/);
    expect(() =>
      adaptDiggypaperProjectDescriptor(new Uint8Array(MAX_PROJECT_DESCRIPTOR_BYTES + 1), sha(raw), {
        asOf,
      }),
    ).toThrow(/^source-oversize$/);
    const invalid = Buffer.from("not-json secret");
    expect(() => adaptDiggypaperProjectDescriptor(invalid, sha(invalid), { asOf })).toThrow(
      /^source-invalid$/,
    );
  });

  it("keeps artifacts of different projects or producer commits distinct, even with one digest", () => {
    const first = adaptDg();
    const packetId = first.artifacts[0]!.artifactId;
    const other = dgNative();
    other.project.project_id = "00000000-0000-4000-8000-000000000053";
    other.project.deep_link = "/projects/" + other.project.project_id;
    other.artifacts[0].deep_link = other.project.deep_link + "/findings";
    const second = adaptDg(other);
    expect(second.artifacts[0]!.sha256).toBe(first.artifacts[0]!.sha256);
    expect(connectorArtifactIdentity(second, packetId)).not.toBe(
      connectorArtifactIdentity(first, packetId),
    );
    const recommit = dgNative();
    recommit.producer.commit = "3".repeat(40);
    expect(connectorArtifactIdentity(adaptDg(recommit), packetId)).not.toBe(
      connectorArtifactIdentity(first, packetId),
    );
    expect(() => connectorArtifactIdentity(first, "packet:absent")).toThrow(
      /^source-incompatible$/,
    );
    expect(
      connectorProjectDescriptorSchema.safeParse({ ...first, accessEffect: "granted" }).success,
    ).toBe(false);
  });
});
