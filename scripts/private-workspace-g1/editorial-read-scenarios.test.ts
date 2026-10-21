import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PRINCIPAL_LABELS } from "./principals.js";
import { programProblems } from "./scenarios.js";
import { EDITORIAL_READ_SCENARIOS } from "./editorial-read-scenarios.js";
import {
  EDITORIAL_READ_ROUTE_MODULES,
  EDITORIAL_READ_SELECT_TABLES,
} from "./editorial-read-routes.js";
import {
  formalReviewReportBodySchema,
  authorResponseBodySchema,
} from "../../packages/contracts/src/editorial.js";
import {
  parseCoarNotifyActivity,
  buildAnnounceReview,
} from "../../packages/federation/src/notify.js";
import { sha256Text } from "./principals.js";

// Read declarative INSERT fixtures without executing application or database code.
function fixtureRows(sql: string, table: string): Record<string, string>[] {
  const result: Record<string, string>[] = [];
  for (const match of sql.matchAll(
    /INSERT INTO "([A-Za-z]+)" \(([\s\S]*?)\)\s*VALUES\s*([\s\S]*?);/gu,
  )) {
    if (match[1] !== table) continue;
    const keys = [...match[2]!.matchAll(/"([^"]+)"/gu)].map((item) => item[1]!);
    const cells = [...match[3]!.matchAll(/'(?:''|[^'])*'|NULL|true|false|\d+/gu)].map((item) =>
      item[0].startsWith("'") ? item[0].slice(1, -1).replaceAll("''", "'") : item[0],
    );
    expect(cells.length % keys.length).toBe(0);
    for (let offset = 0; offset < cells.length; offset += keys.length)
      result.push(Object.fromEntries(keys.map((key, index) => [key, cells[offset + index]!])));
  }
  return result;
}

it("covers four real read surfaces and OPTIONS with all six principal recipes", () => {
  expect(programProblems(EDITORIAL_READ_SCENARIOS)).toEqual([]);
  expect(new Set(EDITORIAL_READ_SCENARIOS.map((s) => s.route))).toEqual(
    new Set(Object.keys(EDITORIAL_READ_ROUTE_MODULES)),
  );
  for (const route of Object.keys(EDITORIAL_READ_ROUTE_MODULES)) {
    expect(
      new Set(EDITORIAL_READ_SCENARIOS.filter((s) => s.route === route).map((s) => s.principal)),
    ).toEqual(new Set(PRINCIPAL_LABELS));
    expect(readFileSync(`apps/web/src/app/${route}/route.ts`, "utf8")).toContain("function GET");
  }
  expect(EDITORIAL_READ_SCENARIOS.every((s) => s.method === "GET" || s.method === "OPTIONS")).toBe(
    true,
  );
  expect(EDITORIAL_READ_SELECT_TABLES).toContain("FederationNotification");
});

it("requires real nonempty projections, editor/admin success, and public hidden/tombstone controls", () => {
  const queue = EDITORIAL_READ_SCENARIOS.filter((s) => s.id.includes("federation-queue"));
  expect(queue.map((s) => s.expect.status)).toEqual([401, 403, 403, 403, 200, 200]);
  const reads = EDITORIAL_READ_SCENARIOS.filter((s) =>
    s.id.includes("proposals-g1-fixture-review"),
  );
  expect(reads).toHaveLength(6);
  for (const read of reads) {
    expect(read.expect.json).toContainEqual({ pointer: "/proposals", length: 2 });
    expect(read.expect.bodyExcludes).toContain("g1-read-tombstone-proposal");
  }
  expect(EDITORIAL_READ_SCENARIOS.filter((s) => s.method === "OPTIONS")).toHaveLength(12);
});

it("seeds contract-valid immutable report/response bodies and exact SHA256 values", () => {
  const sql = readFileSync(
    "scripts/private-workspace-g1/fixtures/editorial-read-fixtures.sql",
    "utf8",
  );
  const bodies = [...sql.matchAll(/'(\{"[^\n]+?\})','([0-9a-f]{64})'/gu)];
  const report = bodies.find((match) => match[1]!.includes('"strengths"'));
  const response = bodies.find((match) => match[1]!.includes('"response"'));
  expect(report).toBeDefined();
  expect(response).toBeDefined();
  formalReviewReportBodySchema.parse(JSON.parse(report![1]!));
  authorResponseBodySchema.parse(JSON.parse(response![1]!));
  for (const match of bodies) {
    expect(sha256Text(match[1]!)).toBe(match[2]);
    if (match[1]!.includes('"@context"')) parseCoarNotifyActivity(JSON.parse(match[1]!));
  }
  expect(bodies.filter((match) => match[1]!.includes('"@context"'))).toHaveLength(5);
});

it("seeds reachable open-round prerequisites and the report writer's actual manual ORCID snapshot", () => {
  const sql = readFileSync(
    "scripts/private-workspace-g1/fixtures/editorial-read-fixtures.sql",
    "utf8",
  );
  const row = (table: string) => fixtureRows(sql, table)[0]!;
  const submission = row("Submission");
  const assignment = row("EditorAssignment");
  const round = row("ReviewRound");
  const report = row("FormalReviewReport");
  const response = row("AuthorResponse");
  expect(submission.status).toBe("pending-editorial-review");
  expect(assignment.submissionId).toBe(submission.id);
  expect(assignment.editorId).toBe(round.openedById);
  expect(assignment.status).toBe("active");
  expect(assignment.coiDeclared).toBe("false");
  expect(assignment.assignedById).toBe("g1-user-admin");
  expect(round.submissionId).toBe(submission.id);
  expect(round.status).toBe("open");
  expect(round.roundNumber).toBe("1");
  expect(assignment.createdAt! < round.openedAt!).toBe(true);
  expect(report.roundId).toBe(round.id);
  expect(report.reviewerId).not.toBe(submission.submitterId);
  expect(report.reviewerId).not.toBe(assignment.editorId);
  expect(report.reviewerId).toBe("g1-user-b-only");
  expect(report.reviewerOrcid).toBe("0000-0000-0000-0002");
  expect(report.reviewerOrcidVerified).toBe("false");
  expect(response.authorId).toBe(submission.submitterId);
  expect(round.openedAt! < report.submittedAt! && report.submittedAt! < response.submittedAt!).toBe(
    true,
  );
  const native = readFileSync("scripts/private-workspace-g1/fixtures/public-fixtures.sql", "utf8");
  expect(native).toContain("'G1 Fixture B-only', 'USER', '0000-0000-0000-0002', NULL");
});

it("seeds terminal federation resolutions and proposals from real same-version citation relations", () => {
  const sql = readFileSync(
    "scripts/private-workspace-g1/fixtures/editorial-read-fixtures.sql",
    "utf8",
  );
  const base = readFileSync("scripts/private-workspace-g1/fixtures/public-fixtures.sql", "utf8");
  for (const row of fixtureRows(sql, "FederationNotification")) {
    if (row.direction === "inbound" && ["accepted", "rejected"].includes(row.status!)) {
      expect(row.resolvedById).toBe("g1-user-editor");
      expect(row.resolutionNote!.length).toBeGreaterThanOrEqual(10);
      expect(row.resolvedAt! > row.createdAt!).toBe(true);
    } else {
      expect(row.resolvedById).toBe("NULL");
      expect(row.resolvedAt).toBe("NULL");
    }
  }
  const claims = fixtureRows(base + sql, "Claim");
  const citations = fixtureRows(base + sql, "Citation");
  const relations = fixtureRows(base + sql, "ClaimEvidenceRelation");
  const statuses = fixtureRows(sql, "CitationStatusRecord");
  for (const proposal of fixtureRows(sql, "ClaimUpdateProposal")) {
    const claim = claims.find((row) => row.id === proposal.claimId)!;
    const citation = citations.find((row) => row.id === proposal.citationId)!;
    expect(claim).toBeDefined();
    expect(citation).toBeDefined();
    expect(citation.reviewVersionId).toBe(claim.reviewVersionId);
    expect(
      relations.some((row) => row.claimId === claim.id && row.citationId === citation.id),
    ).toBe(true);
    const status = statuses.find((row) => row.id === proposal.statusRecordId)!;
    expect(status.workAlias).toBe(`doi:${citation.doi}`);
    expect(proposal.rationale).toBe(
      `Cited work ${status.workAlias} was marked "${status.status}" (source: ${status.source}). This claim relies on it via a "supports" relation.`,
    );
    expect(status.recordedById).toBe("g1-user-editor");
    expect(status.recordedAt! < proposal.createdAt!).toBe(true);
  }
});

it("binds the prepared outbound announcement to an accepted request and exact native builder output", () => {
  const sql = readFileSync(
    "scripts/private-workspace-g1/fixtures/editorial-read-fixtures.sql",
    "utf8",
  );
  const rows = fixtureRows(sql, "FederationNotification");
  const outgoing = rows.find((row) => row.direction === "outbound")!;
  const request = rows.find((row) => row.activityId === outgoing.inReplyTo)!;
  expect(request.status).toBe("accepted");
  expect(request.pattern).toBe("request-review");
  expect(request.originInbox).not.toBe("NULL");
  const parsed = parseCoarNotifyActivity(JSON.parse(request.payloadJson!));
  expect(parsed.pattern).toBe("request-review");
  const target = { id: request.originUri!, inbox: request.originInbox! };
  const identity = {
    versionId: "g1-version-2",
    reviewedResource: request.objectUri,
    target,
    inReplyTo: request.activityId,
  };
  // The production URN hashes canonical JSON recursively, including target keys.
  const canonicalHash = sha256Text(canonicalJson(identity));
  const activityId = `urn:uuid:${canonicalHash.slice(0, 8)}-${canonicalHash.slice(8, 12)}-5${canonicalHash.slice(13, 16)}-a${canonicalHash.slice(17, 20)}-${canonicalHash.slice(20, 32)}`;
  const object = parsed.payload.object;
  const base = "https://g1.oratlas.example";
  const exportBase = `${base}/api/reviews/g1-fixture-review/versions/g1-version-2/export/`;
  const expected = buildAnnounceReview({
    activityId,
    actor: { id: `${base}/system`, name: "Open Review Atlas" },
    review: {
      id: `${base}/reviews/g1-fixture-review/versions/g1-version-2`,
      item: {
        id: exportBase + "json",
        type: "Document",
        mediaType: "application/vnd.oratlas.scholarly+json",
      },
      exports: [
        { id: exportBase + "ro-crate", type: "Document", mediaType: "application/ld+json" },
      ],
    },
    reviewedResource: { id: object.id, type: object.type, item: object["ietf:item"] },
    origin: { id: `${base}/system`, inbox: `${base}/api/federation/inbox` },
    target,
    inReplyTo: request.activityId,
  });
  expect(JSON.parse(outgoing.payloadJson!)).toEqual(expected);
  expect(outgoing.payloadHash).toBe(sha256Text(canonicalJson(expected)));
  expect(outgoing.reviewVersionId).toBe("g1-version-2");
  expect(outgoing.actorUri).toBe(`${base}/system`);
  expect(outgoing.originUri).toBe(`${base}/system`);
  expect(outgoing.objectUri).toBe(expected.object.id);
  expect(outgoing.contextUri).toBe(request.objectUri);
  expect(outgoing.targetUri).toBe(request.originUri);
  expect(outgoing.targetInbox).toBe(request.originInbox);
  expect(outgoing.activityId).toBe(activityId);
});
