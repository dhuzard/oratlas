import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  submitVerificationFindingSchema,
  prepareVerificationArtifactSchema,
} from "../../packages/contracts/src/index.js";
import {
  mystClaimRecordSchema,
  mystPublicationAdapter,
  normalizeMystPublication,
} from "../../packages/publications/src/adapters/myst.js";

const root = new URL("./fixtures/", import.meta.url);
const bytes = (path: string) => readFileSync(new URL(path, root));
const json = (path: string) => JSON.parse(bytes(path).toString("utf8"));
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const pins = json("pins.json");
function myst() {
  return {
    manifest: json("myst/manifest.json"),
    claims: bytes("myst/claims.jsonl")
      .toString("utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line)),
  };
}
function normalize(manifest = myst().manifest, claims = myst().claims) {
  return normalizeMystPublication({
    manifest,
    claims,
    publicationType: "research-article",
    structuralProvenance: "source-byte",
    observedAt: "2026-10-21T00:00:00.000Z",
    registrationKey: "pinned-producer-contract",
  });
}

describe("immutable public producer captures (#221)", () => {
  it("checks every captured byte against explicit SHA-256 pins", () => {
    expect(pins.myst.commit).toBe("51336a5446b449d4d661a4f46d8f8913a0bac2cb");
    expect(pins.verify.commit).toBe("9b8455f5bfe9a411a7f1f06d13e4de97e539ac16");
    for (const [path, digest] of Object.entries(pins.files))
      expect(sha(bytes(path)), path).toBe(digest);
  });
  it("ingests emitted MyST records as source occurrences with exact source bindings", () => {
    const { manifest, claims } = myst();
    expect(manifest.schemaVersion).toBe("0.2.0");
    expect(manifest.publication.source.commit).toBe(pins.myst.commit);
    expect(sha(bytes("myst/claims.jsonl"))).toBe(manifest.artifacts.claims.sha256);
    const result = normalize(manifest, claims);
    expect(result.occurrences).toHaveLength(4);
    for (const [index, claim] of claims.entries()) {
      const source = bytes(`myst/source/${claim.source.documentPath}`).toString("utf8");
      expect(sha(source)).toBe(claim.source.documentSha256);
      expect(
        sha(
          source
            .split("\n")
            .slice(claim.source.startLine - 1, claim.source.endLine)
            .join("\n"),
        ),
      ).toBe(claim.source.blockSha256);
      expect(
        Array.from(source)
          .slice(claim.selector.textPosition.start, claim.selector.textPosition.end)
          .join(""),
      ).toBe(claim.selector.textQuote.exact);
      const occurrence = result.occurrences[index]!;
      expect(occurrence.sourceLocalClaimId).toBe(claim.id);
      expect(occurrence.declaration.authority).toBe("publication-source");
      expect(occurrence).not.toHaveProperty("canonicalNodeId");
      expect(occurrence).not.toHaveProperty("verificationStatus");
    }
  });
  it.each([
    "unsupported schema",
    "missing claim",
    "malformed claim",
    "unsafe path",
    "inconsistent selector",
    "duplicate identifier",
  ])("rejects MyST %s", (name) => {
    const { manifest, claims } = myst();
    if (name === "unsupported schema") manifest.schemaVersion = "99.0.0";
    if (name === "missing claim") claims.pop();
    if (name === "malformed claim") delete claims[0].text;
    if (name === "unsafe path") claims[0].source.documentPath = "../secret.md";
    if (name === "inconsistent selector") claims[0].selector.textPosition.end += 1;
    if (name === "duplicate identifier") {
      claims[1].id = claims[0].id;
      claims[1].target.identifier = claims[0].id;
    }
    expect(() => normalize(manifest, claims)).toThrow();
  });
  it("rejects stale claims digest and a missing claims artifact at the adapter boundary", () => {
    const { manifest } = myst();
    const inventory = {
      artifactKind: "cross-reference-inventory" as const,
      declaredPath: manifest.adapter.xref,
      bytes: new Uint8Array(),
      contentSha256: sha(""),
    };
    expect(() =>
      mystPublicationAdapter.validateCapturedArtifacts({ manifest, artifacts: [inventory] }),
    ).toThrow(/missing claim-stream/);
    expect(() =>
      mystPublicationAdapter.validateCapturedArtifacts({
        manifest,
        artifacts: [
          inventory,
          {
            artifactKind: "claim-stream",
            declaredPath: manifest.artifacts.claims.path,
            bytes: bytes("myst/claims.jsonl"),
            contentSha256: "0".repeat(64),
          },
        ],
      }),
    ).toThrow(/digest/);
  });
  it("does not accept a malformed record even when decoded independently", () => {
    expect(mystClaimRecordSchema.safeParse({}).success).toBe(false);
  });
  it("accepts the actual verifier finding and report bytes under the exact producer protocol", () => {
    const finding = submitVerificationFindingSchema.parse(json("verify/finding.json"));
    const protocol = json("verify/protocol.json");
    const input = json("verify/input.json");
    const report = json("verify/report.json");
    const requests = json("verify/requests.json");
    expect([protocol.seriesKey, protocol.protocolVersion]).toEqual([
      "reported-statistic-consistency",
      "0.1.0",
    ]);
    expect(sha(canonicalJson(input.input))).toBe(input.sha256);
    expect(input.schemaVersion).toBe("verification-publication-input/1.0.0");
    expect(report.schemaVersion).toBe("oratlas-verify-statistics-report/0.1.0");
    expect(report.input.sha256).toBe(input.sha256);
    expect(report.protocol).toEqual({
      series: protocol.seriesKey,
      version: protocol.protocolVersion,
    });
    expect(finding.status).toBe("verified");
    expect(finding.observed).toMatchObject({ library: "scipy" });
    expect(finding).not.toHaveProperty("certificationStatus");
    const prepare = requests.find((r: { path: string }) => r.path.endsWith("/artifacts/prepare"));
    const upload = requests.find((r: { method: string }) => r.method === "PUT");
    expect(prepare).toBeDefined();
    expect(upload.bodySha256).toBe(sha(bytes("verify/report.json")));
    expect(requests.at(-1).path).toBe("/api/publication-versions/synthetic-version/verifications");
    expect(
      prepareVerificationArtifactSchema.safeParse({
        artifactKey: "statistic-report",
        kind: "statistic-report",
        mediaType: "application/json",
        sha256: upload.bodySha256,
        byteLength: bytes("verify/report.json").byteLength,
        visibility: "public",
      }).success,
    ).toBe(true);
  });
  it.each(["malformed result", "forged certification"])("rejects verifier %s", (name) => {
    const finding = json("verify/finding.json");
    if (name === "malformed result") finding.observed = { recomputedP: Number.NaN };
    else finding.certificationStatus = "certified";
    expect(submitVerificationFindingSchema.safeParse(finding).success).toBe(false);
  });
});
