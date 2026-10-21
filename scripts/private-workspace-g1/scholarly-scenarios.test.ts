import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRouteHandlerMethods } from "../check-openapi-routes.js";
import { PRINCIPAL_LABELS } from "./principals.js";
import { SCHOLARLY_ROUTES, SCHOLARLY_SELECT_TABLES } from "./scholarly-routes.js";
import { SCHOLARLY_SCENARIOS } from "./scholarly-scenarios.js";

const sql = readFileSync(
  resolve(process.cwd(), "scripts/private-workspace-g1/fixtures/scholarly-fixtures.sql"),
  "utf8",
);
describe("declarative scholarly G1 batch (not PostgreSQL capture evidence)", () => {
  it("uses only actual GET handlers and provides all six principals for every case", () => {
    const ids = SCHOLARLY_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [route, source] of Object.entries(SCHOLARLY_ROUTES)) {
      expect(source).toBe(`@/app/${route}/route`);
      const methods = parseRouteHandlerMethods(
        readFileSync(resolve(process.cwd(), `apps/web/src/app/${route}/route.ts`), "utf8"),
      );
      expect(methods).toContain("GET");
      const scenarios = SCHOLARLY_SCENARIOS.filter((scenario) => scenario.route === route);
      expect(scenarios.length).toBeGreaterThan(0);
      expect([...new Set(scenarios.map((scenario) => scenario.principal))].sort()).toEqual(
        [...PRINCIPAL_LABELS].sort(),
      );
    }
    for (const path of new Set(SCHOLARLY_SCENARIOS.map((scenario) => scenario.path))) {
      const principals = SCHOLARLY_SCENARIOS.filter((scenario) => scenario.path === path).map(
        (scenario) => scenario.principal,
      );
      expect(principals.sort()).toEqual([...PRINCIPAL_LABELS].sort());
    }
    for (const scenario of SCHOLARLY_SCENARIOS) {
      expect(scenario.method).toBe("GET");
      expect(scenario.expect.status).toBeLessThan(500);
      expect(Boolean(scenario.expect.denial)).toBe(scenario.expect.status >= 400);
      if (scenario.principal !== "anonymous") {
        expect(ids).toContain(scenario.expect.sameResponseAs);
        expect(scenario.session.case).toBe("valid");
      }
    }
  });

  it("has nonempty success assertions and independent removed/raw/draft exclusion controls", () => {
    for (const name of [
      "comments-current",
      "comments-version",
      "annotations",
      "challenges",
      "replications-list",
      "replication-detail",
      "protocol-summary",
    ]) {
      const scenario = SCHOLARLY_SCENARIOS.find(
        (entry) => entry.id === `scholar-${name}-anonymous`,
      )!;
      expect(scenario.expect.status).toBe(200);
      expect(scenario.expect.json?.length).toBeGreaterThan(1);
    }
    const text = JSON.stringify(SCHOLARLY_SCENARIOS);
    for (const marker of [
      "G1_REMOVED_COMMENT_CANARY",
      "G1_REMOVED_CHALLENGE_CANARY",
      "G1_RAW_PROTOCOL_CANARY",
      "g1-replication-hidden-claim",
    ]) {
      expect(sql).toContain(marker);
      expect(text).toContain(marker);
    }
    expect(text).toContain("scholar-comments-tombstone");
    expect(text).toContain("scholar-node-challenges-limit");
    for (const name of [
      "node-challenges-cursor",
      "node-challenges.json-cursor",
      "node-challenges-ro-crate-cursor",
    ]) {
      const control = SCHOLARLY_SCENARIOS.find(
        (scenario) => scenario.id === `scholar-${name}-anonymous`,
      )!;
      expect(control.expect.status).toBe(400);
      expect(control.expect.denial).toEqual({
        code: "bad-request",
        message: "Invalid node challenge cursor.",
      });
    }
  });

  it("requests only read grants and seeds terminal challenges with complete ledgers", () => {
    for (const table of [
      "ReviewComment",
      "Challenge",
      "ChallengeTransition",
      "ReplicationBrief",
      "ProtocolSnapshot",
    ]) {
      expect(SCHOLARLY_SELECT_TABLES).toContain(table);
      expect(sql).toContain(`INSERT INTO "${table}"`);
    }
    expect(sql).toContain("'dismissed'");
    expect(sql).toContain("g1-challenge-visible-filed");
    expect(sql).toContain("g1-challenge-visible-dismissed");
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|GRANT|CREATE)\b(?! path)/u);
  });
});
