import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { canonicalJson, researchProjectDescriptorSchema } from "@oratlas/contracts";
import {
  adaptCRTProjectDescriptor,
  researchArtifactIdentity,
  CRT_PROJECT_DESCRIPTOR_PIN,
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

  it("keeps producer/project/version/digest identities distinct, including synthetic Diggypaper references", () => {
    const crt = adapt();
    const diggypaper = researchProjectDescriptorSchema.parse(
      json("diggypaper.synthetic.private.json"),
    );
    expect(diggypaper.origin).toBe("synthetic-neutral-fixture");
    expect(diggypaper.producerContractPinnedCommit).toBeNull();
    expect(researchArtifactIdentity(crt, "draft")).not.toBe(
      researchArtifactIdentity(diggypaper, "draft"),
    );
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
