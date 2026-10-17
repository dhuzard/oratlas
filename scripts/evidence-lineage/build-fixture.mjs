#!/usr/bin/env node
/**
 * Reproducible build of the Diggypaper → ComputationalReviewTemplate → ORAtlas evidence-lineage
 * fixture (issue #198, MVP Gate G4). Offline; no network, database, PDF or private file.
 *
 *   node scripts/evidence-lineage/build-fixture.mjs \
 *     --crt-dir ../ComputationalReviewTemplate_trust-knowledge \
 *     --diggypaper-dir ../diggypaper [--out <dir>] [--check]
 *
 * Both sibling checkouts must be clean and sit on the exact commits recorded in the fixture's
 * `pins.json`. The packet text is synthetic placeholder text; only bibliographic metadata of the
 * review's own citations is real. `--check` rebuilds into a scratch directory and fails if any
 * byte differs from the committed fixture.
 *
 * Pipeline stages, all executed by the real upstream tools at the pinned revisions:
 *   1. synthesize a source-evidence-packet/0.1.0 using the Template's packet writer;
 *   2. validate it with Diggypaper's reference validator (sep_validate.py, when python is present);
 *   3. import it with the Template's S2 importer and run its Phase 2/5 gates → lineage + Phase 2 package
 *   4. write a reviewed claim→finding map and bridge to `comprev.evidence-packet-links/2` (CRT's
 *      lineage-to-links): mapped findings become evidence, the rest same-paper candidates;
 *   5. export with the Template's S3 exporter             → review-manifest.json + knowledge/oratlas/*
 */
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import process from "node:process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
export const FIXTURE_DIR = join(
  ROOT,
  "packages/extractor/src/fixtures/crt-diggypaper-evidence-lineage",
);

export const PINS = {
  diggypaper: {
    repository: "https://github.com/dhuzard/diggypaper",
    commit: "d7e97e375de75c4e67cd94e0f4efb078f8f4282f",
    role: "source-evidence-packet/0.1.0 contract and reference validator (issue #47)",
  },
  computationalReviewTemplate: {
    repository: "https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge",
    commit: "471ef85bb76e5940a702dee06fcebfd4f6a08669",
    role: "S2 importer + Phase 2/5 gates, reviewed claim-finding map and links/2 bridge (scripts/source-evidence), S3 ORAtlas exporter (scripts/oratlas)",
  },
  oratlas: {
    repository: "https://github.com/dhuzard/oratlas",
    commit: "9cd3a0c284400b30dd0044cf3acb24df1047275d",
    role: "extractor/contract baseline the S3 exporter targets (extractKnowledgeWithOutcomes)",
  },
};

/** Existing ingestion sources whose bytes must remain those of the pinned ORAtlas revision. */
export const BASELINE_FILES = [
  "packages/extractor/src/knowledge.ts",
  "packages/extractor/src/sources.ts",
  "packages/contracts/src/artifacts.ts",
  "packages/contracts/src/manifest.ts",
  "packages/contracts/src/paths.ts",
];

function baselineDigests() {
  return Object.fromEntries(
    BASELINE_FILES.map((path) => [
      path,
      sha256Hex(execFileSync("git", ["-C", ROOT, "show", `${PINS.oratlas.commit}:${path}`])),
    ]),
  );
}

/**
 * The fixture packet is not deposited anywhere. An example DOI keeps that honest: ORAtlas never links
 * a 10.5555/ identifier outward, so the locator path is exercised without implying a real deposit.
 */
export const PACKET_LOCATOR = { kind: "doi", doi: "10.5555/oratlas.fixture.packet" };

/** The review claim that cites two papers and carries the demonstration lineage. */
const LINEAGE_CLAIM_ID = "clm_7659634fb095cdce";
/** Findings the fixture's reviewed map binds to that claim. `finding:cardin2009-f2` is not one. */
const MAPPED_FINDINGS = ["finding:cardin2009-f1", "finding:sohal2009-f1"];

const REVIEW_REPOSITORY_URL = PINS.computationalReviewTemplate.repository;
const TS = "2026-01-01T00:00:00Z";
const TS_ASSESSED = "2026-01-02T00:00:00Z";
const NA = "not-available";
const REVIEWER = "rv-0123456789abcdef";

const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
const sha256Tag = (data) => `sha256:${sha256Hex(data)}`;

function git(dir, ...args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

function assertPinned(dir, pin, label) {
  if (!existsSync(dir)) throw new Error(`${label} checkout not found: ${dir}`);
  const head = git(dir, "rev-parse", "HEAD");
  if (head !== pin.commit) {
    throw new Error(`${label} is at ${head}; this fixture is pinned to ${pin.commit}`);
  }
  if (git(dir, "status", "--porcelain")) throw new Error(`${label} checkout is not clean`);
}

function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}
const pretty = (value) => `${JSON.stringify(stable(value), null, 2)}\n`;

/** Synthetic packet records. Real bibliographic metadata only; every sentence is placeholder text. */
export function packetRecords(citations) {
  const byKey = new Map(citations.map((citation) => [citation.id, citation]));
  const need = (key) => {
    const citation = byKey.get(key);
    if (!citation?.doi) throw new Error(`review citation ${key} with a DOI is required`);
    return citation;
  };
  const paper = (slug, citation, rights, snapshot) => ({
    authors: citation.authors,
    identifiers: { doi: citation.doi, pmcid: NA, pmid: NA },
    paper_id: `paper:${slug}`,
    producer_ids: { article_ref: `article-${slug}` },
    rights: {
      full_text_included: false,
      license: rights === "allowed" ? "synthetic-fixture-text-only" : "unknown",
      redistribution: rights,
    },
    source_snapshot: snapshot
      ? { sha256: snapshot, snapshot_ref: `snapshot:${slug}-1`, state: "captured" }
      : { sha256: NA, snapshot_ref: NA, state: "unavailable" },
    source_type: "journal-article",
    title: citation.title,
  });
  const cardin = need("Cardin2009");
  const sohal = need("Sohal2009");
  const gebru = need("gebru2021datasheets");
  const snapshotOf = (slug) => sha256Tag(Buffer.from(`SYNTHETIC SNAPSHOT ${slug}`, "utf8"));

  const quote = (id, slug, text, start) => ({
    match: { matcher: "quote-matcher-v1", receipt_ref: `receipt:${id}`, status: "exact" },
    paper_id: `paper:${slug}`,
    passage_id: `passage:${id}`,
    producer_ids: { evidence_ref: `evidence-${id}` },
    quote: text,
    quote_sha256: sha256Tag(Buffer.from(text, "utf8")),
    quote_state: "included",
    source: {
      end: start + [...text].length,
      snapshot_ref: `snapshot:${slug}-1`,
      start,
      view_id: "view:text-v1",
    },
  });
  const unknownContext = {
    comparator: "unknown",
    experimental_unit: "unknown",
    exposure: "unknown",
    outcome: "unknown",
    population: "unknown",
    time: "unknown",
  };
  const finding = (id, slug, over) => ({
    context: unknownContext,
    created_at: TS,
    export_state: "approved-for-export",
    finding_id: `finding:${id}`,
    numeric_results: [],
    origin: "reviewer-interpretation",
    paper_id: `paper:${slug}`,
    review_state: "human-reviewed",
    revision: 1,
    verification_level: "human-reviewed",
    ...over,
    producer_ids: {
      answer_ref: `answer-${id}`,
      evidence_refs: over.passage_ids.map((passage) => passage.replace("passage:", "evidence-")),
      prediction_ref: "prediction-lineage-fixture",
    },
  });
  const assess = (id, findingId, passageId, snapshot) => ({
    assessed_at: TS_ASSESSED,
    assessed_snapshot_sha256: snapshot,
    assessment_id: `assessment:${id}`,
    finding_id: `finding:${findingId}`,
    finding_revision: 1,
    passage_id: `passage:${passageId}`,
    producer_ids: { support_assessment_ref: `support-${id}` },
    protocol: "seip-support-v1",
    rationale: "Synthetic fixture rationale; no real reviewer judgment is represented.",
    reviewer_ref: REVIEWER,
    status: "supports",
  });
  const placeholder = (what) =>
    `[SYNTHETIC FIXTURE] Placeholder ${what}; this is not text from the cited article.`;

  const cardinSnap = snapshotOf("cardin2009");
  const sohalSnap = snapshotOf("sohal2009");
  const papers = [
    paper("cardin2009", cardin, "allowed", cardinSnap),
    paper("sohal2009", sohal, "allowed", sohalSnap),
    paper("gebru2021", gebru, "metadata-only", null),
  ];
  const passages = [
    quote("cardin2009-p1", "cardin2009", placeholder("passage 1 of Cardin 2009"), 100),
    quote("cardin2009-p2", "cardin2009", placeholder("passage 2 of Cardin 2009"), 400),
    quote("sohal2009-p1", "sohal2009", placeholder("passage 1 of Sohal 2009"), 100),
    {
      match: { matcher: "unknown", receipt_ref: NA, status: "source_unavailable" },
      paper_id: "paper:gebru2021",
      passage_id: "passage:gebru2021-p1",
      producer_ids: { evidence_ref: "evidence-gebru2021-p1" },
      quote: "withheld",
      quote_sha256: sha256Tag(Buffer.from("SYNTHETIC WITHHELD gebru2021", "utf8")),
      quote_state: "withheld-rights",
      source: { end: null, snapshot_ref: NA, start: null, view_id: NA },
    },
  ];
  const findings = [
    // Two separately addressable findings from ONE article (Cardin 2009).
    finding("cardin2009-f1", "cardin2009", {
      passage_ids: ["passage:cardin2009-p1"],
      statement: placeholder("finding 1 of Cardin 2009"),
      verification_level: "source-verified",
    }),
    finding("cardin2009-f2", "cardin2009", {
      passage_ids: ["passage:cardin2009-p2"],
      statement: placeholder("finding 2 of Cardin 2009"),
    }),
    finding("sohal2009-f1", "sohal2009", {
      passage_ids: ["passage:sohal2009-p1"],
      statement: placeholder("finding 1 of Sohal 2009"),
      verification_level: "source-verified",
    }),
    // Restricted rights, unreviewed: must never become a link.
    finding("gebru2021-f1", "gebru2021", {
      export_state: "proposed",
      passage_ids: ["passage:gebru2021-p1"],
      review_state: "unreviewed",
      statement: placeholder("finding 1 of Gebru 2021"),
      verification_level: "unverified",
    }),
  ];
  const assessments = [
    assess("cardin2009-a1", "cardin2009-f1", "cardin2009-p1", cardinSnap),
    assess("cardin2009-a2", "cardin2009-f2", "cardin2009-p2", cardinSnap),
    assess("sohal2009-a1", "sohal2009-f1", "sohal2009-p1", sohalSnap),
  ];
  return { papers, findings, passages, assessments };
}

function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(dir, path).replaceAll("\\", "/"));
    }
  };
  walk(dir);
  return out.sort();
}

export function digestManifest(dir) {
  const files = {};
  for (const path of listFiles(dir)) {
    if (path === "digests.json") continue;
    const bytes = readFileSync(join(dir, path));
    files[path] = { sha256: sha256Hex(bytes), bytes: bytes.length };
  }
  return { schema: "oratlas.fixture-digests/1", files };
}

async function build({ crtDir, diggypaperDir, out }) {
  assertPinned(crtDir, PINS.computationalReviewTemplate, "ComputationalReviewTemplate");
  if (diggypaperDir) assertPinned(diggypaperDir, PINS.diggypaper, "Diggypaper");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const claimGraphPath = join(crtDir, "knowledge/claim_graph.json");
  const claimGraph = JSON.parse(readFileSync(claimGraphPath, "utf8"));
  const citations = readFileSync(join(crtDir, "knowledge/oratlas/citations.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  // 1. packet, written with the Template's own canonical writer.
  const { writePacket } = await import(
    pathToFileURL(join(crtDir, "tests/helpers/sep-packet.mjs")).href
  );
  const packetDir = join(out, "diggypaper-packet");
  writePacket(packetDir, {
    records: packetRecords(citations),
    manifest: { packet_id: "packet:oratlas-198-lineage-fixture" },
  });

  // 2. Diggypaper's reference validator, when available.
  let referenceValidator = { ran: false, reason: "no --diggypaper-dir" };
  if (diggypaperDir) {
    const validator = join(
      diggypaperDir,
      "docs/contracts/source-evidence-packet/v0.1.0/validator/sep_validate.py",
    );
    let verdict;
    try {
      verdict = JSON.parse(
        execFileSync("python3", ["-I", validator, packetDir], { encoding: "utf8" }),
      );
    } catch (error) {
      throw new Error(
        `Diggypaper reference validator rejected the packet: ${error.stdout ?? error.message}`,
      );
    }
    if (!verdict.valid) throw new Error(`packet invalid: ${JSON.stringify(verdict.errors)}`);
    referenceValidator = { ran: true, valid: true, counts: verdict.counts };
  }

  // 3. S2 importer, with the executable Phase 2 import gate and Phase 5 gate. The importer exits
  // non-zero when a requested gate fails, so a gate failure aborts the build.
  const importDir = join(out, "crt-import");
  const importStdout = execFileSync(
    process.execPath,
    [
      join(crtDir, "scripts/import-source-evidence-packet.mjs"),
      "--packet",
      packetDir,
      "--out",
      importDir,
      "--check-gates",
    ],
    { encoding: "utf8", cwd: crtDir },
  );
  const gates = JSON.parse(importStdout).gates;
  if (gates.phase2_import.gate !== "pass" || gates.phase5.gate !== "pass") {
    throw new Error(`Phase 2/5 gates failed: ${JSON.stringify(gates)}`);
  }
  const lineageBytes = readFileSync(join(importDir, "source-evidence-lineage.json"));
  const lineage = JSON.parse(lineageBytes.toString("utf8"));
  const importReport = JSON.parse(readFileSync(join(importDir, "import-report.json"), "utf8"));
  // The Phase 2 package (cluster_evidence.json) is kept: the reviewed map below is bound to its
  // finding digests, and the test suite re-runs the Phase 5 gate on it.

  // 4. Reviewed claim→finding map, then the bridge. The claim is mapped to one Cardin finding and the
  // Sohal finding; the second Cardin finding is deliberately left unmapped, so it must surface only as
  // a same-paper candidate (one paper, two outcomes, only one of which the claim uses).
  const reviewDir = join(out, "review-repo");
  const claimFindingMap = {
    schema: "comprev.claim-finding-map/1",
    lineage_sha256: sha256Tag(lineageBytes),
    mappings: MAPPED_FINDINGS.map((findingId) => {
      const entry = lineage.entries.find((candidate) => candidate.finding.finding_id === findingId);
      if (!entry) throw new Error(`${findingId} was not accepted by the importer`);
      return {
        claim_id: LINEAGE_CLAIM_ID,
        finding_id: findingId,
        finding_revision: entry.finding.revision,
        phase2_finding_sha256: entry.phase2_finding_sha256,
        decision_ref: "fixture:oratlas-198/map-001",
        asserted_at: "2026-01-03T00:00:00Z",
        basis: "Synthetic fixture decision; no real reviewer judgment is represented.",
      };
    }),
  };
  writeText(join(reviewDir, "knowledge/claim-finding-map.json"), pretty(claimFindingMap));
  const { lineageToLinks } = await import(
    pathToFileURL(join(crtDir, "scripts/source-evidence/lineage-to-links.mjs")).href
  );
  const { links, skipped } = lineageToLinks(lineageBytes, claimGraph, {
    locator: PACKET_LOCATOR,
    claimFindingMap,
  });
  for (const path of [
    "knowledge/claim_graph.json",
    "knowledge/trust_score_report.json",
    "content/references.bib",
  ]) {
    mkdirSync(dirname(join(reviewDir, path)), { recursive: true });
    cpSync(join(crtDir, path), join(reviewDir, path));
  }
  writeText(join(reviewDir, "knowledge/evidence-links.json"), pretty(links));

  // 5. S3 exporter, run from the review repo copy so recorded input paths are relative.
  execFileSync(
    process.execPath,
    [
      join(crtDir, "scripts/oratlas/export-oratlas.mjs"),
      "--root",
      reviewDir,
      "--repository-url",
      REVIEW_REPOSITORY_URL,
      "--title",
      "Computational Review Template",
      "--license",
      "MIT",
      "--evidence-links",
      "knowledge/evidence-links.json",
      "--output-dir",
      reviewDir,
    ],
    { encoding: "utf8", cwd: crtDir },
  );

  writeText(
    join(out, "build-report.json"),
    pretty({
      schema: "oratlas.evidence-lineage-build-report/1",
      reference_validator: referenceValidator,
      import: { counts: importReport.counts },
      gates: {
        phase2_import: gates.phase2_import.gate,
        phase5: gates.phase5.gate,
        exempt_checks: gates.phase2_import.exempt_checks,
      },
      links: {
        emitted: links.findings.length,
        reviewed_mappings: links.findings.filter((f) => f.binding === "reviewed-mapping").length,
        same_paper_candidates: links.findings.filter((f) => f.binding === "same-paper-candidate")
          .length,
        skipped,
      },
    }),
  );
  writeText(
    join(out, "pins.json"),
    pretty({
      schema: "oratlas.fixture-pins/1",
      pins: PINS,
      oratlasBaselineFileSha256: baselineDigests(),
    }),
  );
  writeText(join(out, "digests.json"), pretty(digestManifest(out)));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg.startsWith("--")) args[arg.slice(2)] = argv[++i];
    else throw new Error(`unexpected argument ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args["crt-dir"]) {
    process.stderr.write(
      "usage: build-fixture.mjs --crt-dir <dir> [--diggypaper-dir <dir>] [--out <dir>] [--check]\n",
    );
    process.exit(2);
  }
  const crtDir = resolve(args["crt-dir"]);
  const diggypaperDir = args["diggypaper-dir"] ? resolve(args["diggypaper-dir"]) : undefined;
  const target = resolve(args.out ?? FIXTURE_DIR);
  if (!args.check) {
    await build({ crtDir, diggypaperDir, out: target });
    process.stdout.write(`Wrote fixture to ${target}\n`);
    return;
  }
  const scratch = mkdtempSync(join(tmpdir(), "oratlas-lineage-"));
  try {
    await build({ crtDir, diggypaperDir, out: scratch });
    const expected = digestManifest(scratch).files;
    const actual = digestManifest(target).files;
    const paths = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const drift = [...paths].filter((path) => expected[path]?.sha256 !== actual[path]?.sha256);
    if (drift.length > 0) {
      process.stderr.write(`Fixture drift in ${drift.length} file(s):\n${drift.join("\n")}\n`);
      process.exit(1);
    }
    process.stdout.write(`Fixture reproduces byte-for-byte (${paths.size} files).\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
