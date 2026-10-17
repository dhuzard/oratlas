/**
 * Offline pass/fail verification of the pinned Diggypaper → ComputationalReviewTemplate → ORAtlas
 * evidence-lineage fixture (issue #198, MVP Gate G4). No network, database or sibling checkout.
 *
 *   pnpm evidence-lineage:verify            # human-readable report, exit 1 on any failure
 *   pnpm evidence-lineage:verify --json     # machine-readable report
 *
 * The behavioural pipeline (inspection → extraction → acceptance → public API) is exercised by
 * apps/web/src/lib/crt-diggypaper-lineage.integration.test.ts; this script checks the committed
 * inputs those tests rely on and that the existing ingestion code is the pinned revision.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditSourceEvidencePacket,
  type PacketLinkClaim,
} from "../../packages/extractor/src/source-evidence-packet-audit";
import { loadEvidenceLineageFixture } from "../../packages/extractor/src/fixtures/evidence-lineage";

export interface Check {
  id: string;
  /** `baseline` checks compare the working tree to the pinned ORAtlas revision and may drift legitimately. */
  kind: "fixture" | "baseline";
  ok: boolean;
  detail: string;
}

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const sha256Hex = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const SIDECAR_PATH = "knowledge/oratlas/source-native-trust.json";

export function verifyFixture(): Check[] {
  const fixture = loadEvidenceLineageFixture();
  const checks: Check[] = [];
  const add = (id: string, ok: boolean, detail: string, kind: Check["kind"] = "fixture") =>
    checks.push({ id, kind, ok, detail });

  const pins = fixture.pins.pins;
  add(
    "pins-are-exact-commits",
    ["diggypaper", "computationalReviewTemplate", "oratlas"].every((name) =>
      /^[0-9a-f]{40}$/.test(pins[name]?.commit ?? ""),
    ),
    Object.entries(pins)
      .map(([name, pin]) => `${name}@${pin.commit.slice(0, 12)}`)
      .join(", "),
  );

  const drift: string[] = [];
  for (const [path, digest] of Object.entries(fixture.digests.files)) {
    const content = fixture.all[path];
    if (content === undefined || sha256Hex(content) !== digest.sha256) drift.push(path);
  }
  const undeclared = Object.keys(fixture.all).filter(
    (path) => path !== "digests.json" && !(path in fixture.digests.files),
  );
  add(
    "fixture-digest-manifest",
    drift.length === 0 && undeclared.length === 0,
    `${Object.keys(fixture.digests.files).length} files; drift=[${drift}] undeclared=[${undeclared}]`,
  );

  const sidecar = JSON.parse(fixture.reviewFiles[SIDECAR_PATH]!);
  const links: PacketLinkClaim[] = sidecar.evidence_links.map((link: Record<string, string>) => ({
    findingId: link.finding_id!,
    packetId: link.packet_id!,
    packetSha256: link.packet_sha256!,
    sourceSha256: link.finding_source_sha256!,
    doi: link.doi ?? null,
    declared: {
      revision: link.finding_revision as unknown as number,
      verificationLevel: link.verification_level as string,
      passages: (link.passages as unknown as Array<Record<string, string>>).map((p) => ({
        passageId: p.passage_id!,
        quoteSha256: p.quote_sha256!,
        quoteState: p.quote_state!,
        matchStatus: p.match_status!,
      })),
      assessments: (link.assessments as unknown as Array<Record<string, string>>).map((a) => ({
        assessmentId: a.assessment_id!,
        protocol: a.protocol!,
        status: a.status!,
      })),
    },
  }));
  add(
    "sidecar-binds-packet-digest",
    links.length > 0 &&
      links.every((link) => link.packetSha256 === sha256Hex(fixture.packetFiles["manifest.json"]!)),
    `${links.length} link(s) declare packet sha256 ${links[0]?.packetSha256.slice(0, 16)}…`,
  );
  const audit = auditSourceEvidencePacket(fixture.packetFiles, links);
  add(
    "packet-resolves-findings-to-passage-and-snapshot-hashes",
    audit.ok && audit.lineage.length === links.length,
    audit.ok
      ? `${audit.lineage.length} finding(s) resolve to passage digests and source-snapshot digests`
      : audit.issues.map((issue) => issue.code).join(", "),
  );
  const perPaper = new Map<string, number>();
  for (const entry of audit.lineage)
    perPaper.set(entry.paperId, (perPaper.get(entry.paperId) ?? 0) + 1);
  add(
    "two-findings-from-one-article",
    [...perPaper.values()].some((count) => count >= 2) &&
      new Set(audit.lineage.map((entry) => entry.findingId)).size === audit.lineage.length,
    [...perPaper.entries()].map(([paper, count]) => `${paper}:${count}`).join(", "),
  );
  add(
    "native-trust-separate",
    !(
      "trustAssessments" in
      (JSON.parse(fixture.reviewFiles["review-manifest.json"]!).artifacts ?? {})
    ) &&
      sidecar.source_native_provenance.oratlas_re_adjudicated === false &&
      sidecar.source_native_provenance.semantic_origin === "source_native_trust",
    "manifest declares no trustAssessments; sidecar is source_native_trust, not re-adjudicated",
  );

  const baselines = (
    fixture.pins as unknown as { oratlasBaselineFileSha256: Record<string, string> }
  ).oratlasBaselineFileSha256;
  for (const [path, expected] of Object.entries(baselines)) {
    const actual = sha256Hex(readFileSync(resolve(ROOT, path)));
    add(
      `extractor-baseline:${path}`,
      actual === expected,
      actual === expected ? "unchanged since pin" : `changed (${actual.slice(0, 12)}…)`,
      "baseline",
    );
  }
  return checks;
}

function main(): void {
  const json = process.argv.includes("--json");
  const allowBaselineDrift = process.argv.includes("--allow-baseline-drift");
  const checks = verifyFixture();
  const failed = checks.filter(
    (check) => !check.ok && !(allowBaselineDrift && check.kind === "baseline"),
  );
  if (json) {
    process.stdout.write(`${JSON.stringify({ pass: failed.length === 0, checks }, null, 2)}\n`);
  } else {
    for (const check of checks) {
      process.stdout.write(`${check.ok ? "PASS" : "FAIL"}  ${check.id}  ${check.detail}\n`);
    }
    process.stdout.write(
      `\n${failed.length === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failed.length})`}\n`,
    );
  }
  process.exitCode = failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
