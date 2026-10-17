import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createFakeTransport, inspectRepository } from "@oratlas/github";
import { auditSourceEvidencePacket, runExtraction, type PacketLinkClaim } from "@oratlas/extractor";
import { sourceEvidenceLinksSchema, type SourceEvidenceLinks } from "@oratlas/contracts";
import type { PrismaClient } from "@oratlas/db";
import type { buildValidationReport } from "./ingest";
import type { createInspectionCapture } from "./inspection-captures";
import type { acceptSubmission, createSubmission } from "./submissions";
import {
  LINEAGE_CLAIM_ID,
  REVIEW_REPOSITORY,
  loadEvidenceLineageFixture,
  reviewRepoTransportFixture,
} from "../../../../packages/extractor/src/fixtures/evidence-lineage";

/**
 * End-to-end regression for issue #198 (MVP Gate G4), fully offline:
 *
 *   Diggypaper packet → CRT S2 import → CRT S3 export (committed, digest-pinned fixture)
 *     → repository inspection → manifest parsing → extractKnowledgeWithOutcomes
 *     → submission → editorial acceptance (test database)
 *     → public representations: GET /api/graph, claim passport API, preserved-file API.
 */
vi.mock("server-only", () => ({}));

const fixture = loadEvidenceLineageFixture();
const databasePath = `/tmp/oratlas-lineage-${process.pid}-${Date.now()}.db`;
const SIDECAR_PATH = "knowledge/oratlas/source-native-trust.json";
const RELATIONS_PATH = "knowledge/oratlas/relations.jsonl";
const CLAIMS_PATH = "knowledge/oratlas/claims.jsonl";
const COMMIT = (n: number) => String(n).repeat(40).slice(0, 40);
const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const lines = (text: string) =>
  text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
const jsonl = (records: unknown[]) =>
  `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;

interface PassportBody {
  evidence: Array<{
    relationType: string;
    citationLocalId: string;
    hasTrustAssessment: boolean;
    trustAssessments: unknown[];
  }>;
  sourceEvidenceLinks: SourceEvidenceLinks;
  compatibilityReport: { artifactOutcomes: { relations: { status: string } } };
}
interface GraphNode {
  nodeId: string;
  kind: string;
  text?: string;
  payload: { doi?: string };
  provenance: { reviewVersionId?: string };
}
interface GraphEdge {
  sourceNodeId: string;
  targetNodeId: string;
  relationType: string;
  status: string;
  trustAssessments: unknown[];
}
interface GraphBody {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
interface SidecarDoc {
  evidence_links: Array<Record<string, unknown>>;
  claims: unknown[];
}

type Rt = {
  prisma: PrismaClient;
  createInspectionCapture: typeof createInspectionCapture;
  createSubmission: typeof createSubmission;
  acceptSubmission: typeof acceptSubmission;
  buildValidationReport: typeof buildValidationReport;
};
let rt: Rt;
let submitterId: string;
let editorId: string;

interface Ingested {
  versionId: string;
  slug: string;
  submissionId: string;
  commit: string;
  extraction: ReturnType<typeof runExtraction>;
}

async function ingest(files: Record<string, string>, commit: string): Promise<Ingested> {
  const now = () => new Date("2026-07-01T00:00:00Z");
  const report = await inspectRepository(REVIEW_REPOSITORY.url, {
    transport: createFakeTransport(
      reviewRepoTransportFixture(files, { commitSha: commit, treeSha: commit.replace(/^./, "e") }),
    ),
    now,
  });
  const extraction = runExtraction(report, now);
  const validation = await rt.buildValidationReport(
    report,
    extraction.compatibility,
    extraction.metadata,
    undefined,
    extraction.knowledge.claims.length > 0 && extraction.knowledge.citations.length > 0,
    extraction.knowledge.trust.length > 0,
    false,
  );
  const capability = await rt.createInspectionCapture(submitterId, report, extraction, validation);
  const submission = await rt.createSubmission({
    inspectionToken: capability.token,
    submitterId,
  });
  const accepted = await rt.acceptSubmission(submission.submissionId, editorId);
  const snapshot = await rt.prisma.repositorySnapshot.findFirstOrThrow({
    where: { commitSha: commit },
  });
  const version = await rt.prisma.reviewVersion.findFirstOrThrow({
    where: { snapshotId: snapshot.id },
  });
  return {
    versionId: version.id,
    slug: accepted.reviewSlug!,
    submissionId: submission.submissionId,
    commit,
    extraction,
  };
}

async function passportApi(versionId: string, localClaimId = LINEAGE_CLAIM_ID) {
  const { GET } = await import("@/app/api/claims/[versionId]/[localClaimId]/route");
  const response = await GET(new Request("http://localhost/api/claims/x"), {
    params: Promise.resolve({ versionId, localClaimId }),
  });
  return { status: response.status, body: (await response.json()) as PassportBody };
}

async function graphApi(seed: string) {
  const { GET } = await import("@/app/api/graph/route");
  const response = await GET(
    new Request(
      `http://localhost/api/graph?seed=${encodeURIComponent(seed)}&direction=both&status=authoritative&limit=25`,
    ),
  );
  return { status: response.status, body: (await response.json()) as GraphBody };
}

async function claimNodeId(versionId: string, localClaimId = LINEAGE_CLAIM_ID) {
  const claim = await rt.prisma.claim.findFirstOrThrow({
    where: { reviewVersionId: versionId, localClaimId },
  });
  return claim.knowledgeNodeId!;
}

function withSidecar(
  files: Record<string, string>,
  edit: (sidecar: SidecarDoc) => void,
): Record<string, string> {
  const sidecar = JSON.parse(files[SIDECAR_PATH]!);
  edit(sidecar);
  return { ...files, [SIDECAR_PATH]: `${JSON.stringify(sidecar, null, 2)}\n` };
}

/** Every row that belongs to one accepted version, for byte-level immutability comparison. */
async function dumpVersion(versionId: string) {
  const version = await rt.prisma.reviewVersion.findUniqueOrThrow({ where: { id: versionId } });
  const [claims, citations, relations, snapshot, assessments] = await Promise.all([
    rt.prisma.claim.findMany({ where: { reviewVersionId: versionId }, orderBy: { id: "asc" } }),
    rt.prisma.citation.findMany({ where: { reviewVersionId: versionId }, orderBy: { id: "asc" } }),
    rt.prisma.claimEvidenceRelation.findMany({
      where: { claim: { reviewVersionId: versionId } },
      orderBy: { id: "asc" },
    }),
    rt.prisma.repositorySnapshot.findUniqueOrThrow({ where: { id: version.snapshotId! } }),
    rt.prisma.trustAssessment.findMany({
      where: { relation: { claim: { reviewVersionId: versionId } } },
    }),
  ]);
  return JSON.stringify({ version, claims, citations, relations, snapshot, assessments });
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${databasePath}`;
  process.env.AUTH_MOCK = "1";
  execFileSync(
    process.execPath,
    [
      resolve(process.cwd(), "packages/db/node_modules/prisma/build/index.js"),
      "db",
      "push",
      "--schema",
      "packages/db/prisma/schema.prisma",
      "--skip-generate",
    ],
    { env: { ...process.env, DATABASE_URL: `file:${databasePath}` }, stdio: "pipe" },
  );
  const { prisma } = await import("./db");
  const captures = await import("./inspection-captures");
  const submissions = await import("./submissions");
  rt = {
    prisma,
    createInspectionCapture: captures.createInspectionCapture,
    createSubmission: submissions.createSubmission,
    acceptSubmission: submissions.acceptSubmission,
    buildValidationReport: (await import("./ingest")).buildValidationReport,
  };
  submitterId = (
    await prisma.user.create({
      data: { githubUserId: "lineage-submitter", githubLogin: "lineage-submitter", role: "USER" },
    })
  ).id;
  editorId = (
    await prisma.user.create({
      data: { githubUserId: "lineage-editor", githubLogin: "lineage-editor", role: "EDITOR" },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  await rt?.prisma.$disconnect();
  for (const path of [databasePath, `${databasePath}-journal`, `${databasePath}-wal`]) {
    if (existsSync(path)) rmSync(path);
  }
});

describe.sequential(
  "Diggypaper → ComputationalReviewTemplate → ORAtlas lineage (pinned, offline)",
  () => {
    let base: Ingested;
    let baseDump: string;

    it("accepts the real exported review through the unchanged submission pipeline", async () => {
      base = await ingest(fixture.reviewFiles, COMMIT(1));
      baseDump = await dumpVersion(base.versionId);
      const counts = {
        claims: await rt.prisma.claim.count({ where: { reviewVersionId: base.versionId } }),
        citations: await rt.prisma.citation.count({ where: { reviewVersionId: base.versionId } }),
        relations: await rt.prisma.claimEvidenceRelation.count({
          where: { claim: { reviewVersionId: base.versionId } },
        }),
        oratlasTrust: await rt.prisma.trustAssessment.count(),
      };
      expect(counts).toEqual({ claims: 4, citations: 5, relations: 5, oratlasTrust: 0 });
      expect(base.extraction.knowledge.warnings).toEqual([]);
      expect(base.extraction.manifest?.artifacts?.provenance).toBe(SIDECAR_PATH);
    });

    it("traverses claim → citations → works through GET /api/graph with typed relations and no TRUST", async () => {
      const result = await graphApi(await claimNodeId(base.versionId));
      expect(result.status).toBe(200);
      const nodes = result.body.nodes;
      const claim = nodes.find((node) => node.kind === "claim")!;
      expect(claim.text).toContain("Optogenetic studies in mice");
      expect(claim.provenance.reviewVersionId).toBe(base.versionId);
      const works = nodes.filter((node) => node.kind === "work");
      expect(works.map((work) => work.payload.doi).sort()).toEqual([
        "10.1038/nature07991",
        "10.1038/nature08002",
      ]);
      const edges = result.body.edges;
      const outgoing = edges.filter((edge) => edge.sourceNodeId === claim.nodeId);
      expect(
        outgoing
          .map((edge) => [
            edge.relationType,
            works.find((w) => w.nodeId === edge.targetNodeId)?.payload.doi,
          ])
          .sort(),
      ).toEqual([
        ["partially-supports", "10.1038/nature07991"],
        ["supports", "10.1038/nature08002"],
      ]);
      // Source assertions only: no ORAtlas TRUST projection is attached, none is invented.
      expect(edges.every((edge) => edge.status === "source-assertion")).toBe(true);
      expect(edges.every((edge) => edge.trustAssessments.length === 0)).toBe(true);
    });

    it("serves the full producer-finding lineage from the public claim passport API", async () => {
      const { status, body } = await passportApi(base.versionId);
      expect(status).toBe(200);
      const links = sourceEvidenceLinksSchema.parse(
        body.sourceEvidenceLinks,
      ) as SourceEvidenceLinks;
      expect(links.status).toBe("linked");
      expect(links.rejected).toEqual([]);
      expect(
        links.citations.map((citation) => [
          citation.citationLocalId,
          citation.relation.relationType,
        ]),
      ).toEqual([
        ["Cardin2009", "supports"],
        ["Sohal2009", "partially-supports"],
      ]);
      expect(links.citations[0]!.findings.map((finding) => finding.findingId)).toEqual([
        "finding:cardin2009-f1",
        "finding:cardin2009-f2",
      ]);
      // ORAtlas TRUST stays absent on every evidence relation; native TRUST is labelled source-native.
      expect(body.evidence.every((relation) => relation.hasTrustAssessment === false)).toBe(true);
      expect(body.evidence.every((relation) => relation.trustAssessments.length === 0)).toBe(true);
      expect(links.nativeAssessment).toMatchObject({
        origin: "source-native",
        isOratlasAssessment: false,
        reAdjudicatedByOratlas: false,
      });
      // The packet is external and unverified by ORAtlas.
      expect(links.packets[0]).toMatchObject({
        contentsImportedByOratlas: false,
        contentsVerifiedByOratlas: false,
        availability: "location-not-declared",
      });
      expect(JSON.stringify(body)).not.toMatch(/peer.reviewed|independently replicated/i);
    });

    it("serves the sidecar byte for byte and binds its digest to the passport", async () => {
      const { GET } =
        await import("@/app/api/reviews/[slug]/versions/[versionId]/files/[...path]/route");
      const response = await GET(new Request("http://localhost/api/files"), {
        params: Promise.resolve({
          slug: base.slug,
          versionId: base.versionId,
          path: SIDECAR_PATH.split("/"),
        }),
      });
      expect(response.status).toBe(200);
      const served = await response.text();
      expect(served).toBe(fixture.reviewFiles[SIDECAR_PATH]);
      const { body } = await passportApi(base.versionId);
      expect(body.sourceEvidenceLinks.sidecar?.sha256).toBe(sha256Hex(served));
      expect(body.sourceEvidenceLinks.sidecar?.path).toBe(SIDECAR_PATH);
    });

    it("resolves each declared finding to its exact passage digest and source snapshot digest", async () => {
      const { body } = await passportApi(base.versionId);
      const served = JSON.parse(fixture.reviewFiles[SIDECAR_PATH]!);
      const declared: PacketLinkClaim[] = served.evidence_links.map(
        (link: Record<string, string | null>) => ({
          findingId: link.finding_id,
          packetId: link.packet_id,
          packetSha256: link.packet_sha256,
          sourceSha256: link.finding_source_sha256,
          doi: link.doi,
        }),
      );
      // The passport exposes exactly the identifiers the audit needs; nothing else is trusted.
      expect(
        body.sourceEvidenceLinks.citations
          .flatMap((citation) => citation.findings)
          .map((finding) => [finding.findingId, finding.sourceSnapshotSha256]),
      ).toEqual(declared.map((link) => [link.findingId, link.sourceSha256]));
      expect(body.sourceEvidenceLinks.packets[0]?.packetSha256).toBe(declared[0]!.packetSha256);

      const audit = auditSourceEvidencePacket(fixture.packetFiles, declared);
      expect(audit).toMatchObject({ ok: true, issues: [] });
      const cardin = audit.lineage.filter((entry) => entry.findingId.startsWith("finding:cardin"));
      expect(cardin).toHaveLength(2);
      expect(new Set(cardin.map((entry) => entry.snapshotSha256)).size).toBe(1);
      expect(new Set(cardin.map((entry) => entry.passages[0]!.passageId)).size).toBe(2);
      for (const entry of audit.lineage) {
        expect(entry.passages[0]!.matchStatus).toBe("exact");
        expect(entry.assessments[0]).toMatchObject({
          protocol: "seip-support-v1",
          status: "supports",
        });
        expect(entry.assessments[0]!.assessedSnapshotSha256).toBe(entry.snapshotSha256);
      }
    });

    it("never exposes the restricted, unreviewed finding or any quote text anywhere public", async () => {
      const passport = JSON.stringify((await passportApi(base.versionId)).body);
      const graph = JSON.stringify((await graphApi(await claimNodeId(base.versionId))).body);
      const everything = `${passport}${graph}`;
      expect(everything).not.toContain("gebru2021-f1");
      expect(everything).not.toContain("SYNTHETIC FIXTURE]");
      expect(everything).not.toContain("SYNTHETIC WITHHELD");
      const preserved = await rt.prisma.repositorySnapshot.findFirstOrThrow({
        where: { commitSha: base.commit },
      });
      expect(preserved.preservedFilesJson).not.toContain("SYNTHETIC FIXTURE]");
    });

    it("reports claims without producer findings explicitly", async () => {
      const { body } = await passportApi(base.versionId, "clm_3ea62e8a65cbdb75");
      expect(body.sourceEvidenceLinks).toMatchObject({
        status: "no-producer-finding",
        citations: [],
        rejected: [],
      });
    });

    it("treats a duplicate import of the same commit as a no-op or an explicit refusal", async () => {
      const versionsBefore = await rt.prisma.reviewVersion.count();
      // Re-accepting the same submission is idempotent and creates nothing.
      await expect(rt.acceptSubmission(base.submissionId, editorId)).resolves.toMatchObject({
        idempotent: true,
        reviewSlug: base.slug,
      });
      // A fresh inspection of the identical commit is refused by the existing pipeline.
      await expect(ingest(fixture.reviewFiles, COMMIT(1))).rejects.toThrow(
        /already published for the commit/,
      );
      expect(await rt.prisma.reviewVersion.count()).toBe(versionsBefore);
      expect(await dumpVersion(base.versionId)).toBe(baseDump);
    });

    it("is invariant under reordered records (new commit, reversed JSONL and sidecar order)", async () => {
      const reversed = { ...fixture.reviewFiles };
      for (const path of [CLAIMS_PATH, "knowledge/oratlas/citations.jsonl", RELATIONS_PATH]) {
        reversed[path] = jsonl(lines(fixture.reviewFiles[path]!).reverse());
      }
      const files = withSidecar(reversed, (sidecar) => {
        sidecar.evidence_links.reverse();
        sidecar.claims.reverse();
      });
      const second = await ingest(files, COMMIT(2));
      const original = (await passportApi(base.versionId)).body;
      const reordered = (await passportApi(second.versionId)).body;
      const { sidecar: _a, ...originalLinks } = original.sourceEvidenceLinks;
      const { sidecar: _b, ...reorderedLinks } = reordered.sourceEvidenceLinks;
      expect(reorderedLinks).toEqual(originalLinks);
      const graph = (await graphApi(await claimNodeId(second.versionId))).body;
      const edgeShape = (edges: GraphEdge[], works: GraphNode[]) =>
        edges
          .filter((edge) => edge.relationType !== "asserts")
          .map((edge) => [
            edge.relationType,
            works.find((w) => w.nodeId === edge.targetNodeId)?.payload.doi,
          ])
          .sort();
      const originalGraph = (await graphApi(await claimNodeId(base.versionId))).body;
      expect(
        edgeShape(
          graph.edges,
          graph.nodes.filter((n) => n.kind === "work"),
        ),
      ).toEqual(
        edgeShape(
          originalGraph.edges,
          originalGraph.nodes.filter((n) => n.kind === "work"),
        ),
      );
    });

    it("flags a stale sidecar (claim text changed after export) and withholds lineage and native score", async () => {
      const claims = lines(fixture.reviewFiles[CLAIMS_PATH]!).map((claim) =>
        claim.id === LINEAGE_CLAIM_ID
          ? { ...claim, text: String(claim.text).replace("in mice", "in rats") }
          : claim,
      );
      const stale = await ingest(
        { ...fixture.reviewFiles, [CLAIMS_PATH]: jsonl(claims) },
        COMMIT(3),
      );
      const { body } = await passportApi(stale.versionId);
      expect(body.sourceEvidenceLinks).toMatchObject({
        status: "sidecar-stale",
        citations: [],
        nativeAssessment: null,
      });
      expect(body.sourceEvidenceLinks.rejected).toHaveLength(3);
    });

    it("rejects a wrong DOI in the sidecar and still shows the review's own relation", async () => {
      const files = withSidecar(fixture.reviewFiles, (sidecar) => {
        sidecar.evidence_links[0]!.doi = "10.1038/nature99999";
      });
      const wrong = await ingest(files, COMMIT(4));
      const { body } = await passportApi(wrong.versionId);
      expect(body.sourceEvidenceLinks.rejected).toEqual([
        { findingId: "finding:cardin2009-f1", citeKey: "Cardin2009", reason: "doi-mismatch" },
      ]);
      expect(body.evidence.map((relation) => relation.citationLocalId).sort()).toEqual([
        "Cardin2009",
        "Sohal2009",
      ]);
    });

    it("rejects links whose citation edge is absent from the accepted review", async () => {
      const relations = lines(fixture.reviewFiles[RELATIONS_PATH]!).filter(
        (relation) =>
          !(relation.claimId === LINEAGE_CLAIM_ID && relation.citationId === "Sohal2009"),
      );
      const absent = await ingest(
        { ...fixture.reviewFiles, [RELATIONS_PATH]: jsonl(relations) },
        COMMIT(5),
      );
      const { body } = await passportApi(absent.versionId);
      expect(body.sourceEvidenceLinks.rejected).toEqual([
        { findingId: "finding:sohal2009-f1", citeKey: "Sohal2009", reason: "no-citation-relation" },
      ]);
      const graph = (await graphApi(await claimNodeId(absent.versionId))).body;
      expect(graph.edges.filter((edge) => edge.relationType === "partially-supports")).toEqual([]);
    });

    it("reports a missing declared relations artifact instead of silently flattening it", async () => {
      const files = { ...fixture.reviewFiles };
      delete files[RELATIONS_PATH];
      const missing = await ingest(files, COMMIT(6));
      const { body } = await passportApi(missing.versionId);
      expect(body.evidence).toEqual([]);
      expect(body.compatibilityReport.artifactOutcomes.relations.status).not.toBe("loaded");
      expect(body.sourceEvidenceLinks.citations).toEqual([]);
      expect(body.sourceEvidenceLinks.rejected.map((link) => link.reason)).toEqual([
        "no-citation-relation",
        "no-citation-relation",
        "no-citation-relation",
      ]);
    });

    it("rejects an ambiguous source relationship instead of choosing one", async () => {
      const files = withSidecar(fixture.reviewFiles, (sidecar) => {
        sidecar.evidence_links.push({
          ...sidecar.evidence_links[0],
          cite_key: "Sohal2009",
          doi: "10.1038/nature07991",
        });
      });
      const ambiguous = await ingest(files, COMMIT(7));
      const { body } = await passportApi(ambiguous.versionId);
      const rejected = body.sourceEvidenceLinks.rejected.filter(
        (link) => link.findingId === "finding:cardin2009-f1",
      );
      expect(rejected.map((link) => link.reason)).toEqual([
        "ambiguous-source-relationship",
        "ambiguous-source-relationship",
      ]);
      expect(
        body.sourceEvidenceLinks.citations
          .flatMap((citation) => citation.findings)
          .map((finding) => finding.findingId),
      ).not.toContain("finding:cardin2009-f1");
    });

    it("stops serving lineage and sidecar bytes once a version is no longer publicly readable", async () => {
      const victim = await ingest(fixture.reviewFiles, COMMIT(8));
      await rt.prisma.reviewVersion.update({
        where: { id: victim.versionId },
        data: { publicState: "tombstoned" },
      });
      expect((await passportApi(victim.versionId)).status).toBe(404);
      const { GET } =
        await import("@/app/api/reviews/[slug]/versions/[versionId]/files/[...path]/route");
      const response = await GET(new Request("http://localhost/api/files"), {
        params: Promise.resolve({
          slug: victim.slug,
          versionId: victim.versionId,
          path: SIDECAR_PATH.split("/"),
        }),
      });
      expect(response.status).toBe(404);
    });

    it("left every earlier accepted record byte-identical", async () => {
      expect(await dumpVersion(base.versionId)).toBe(baseDump);
    });
  },
);
