import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { certificationProtocolDefinitionSchema } from "../../packages/contracts/src/certification.js";
import { createVerificationProtocolSchema } from "../../packages/contracts/src/verification.js";
import { PRINCIPAL_LABELS } from "./principals.js";
import {
  programProblems,
  SCENARIOS,
  type HttpScenario,
  type StateProjection,
} from "./scenarios.js";
import { EDITORIAL_ROUTE_MODULES } from "./editorial-routes.js";
import {
  editorialScenarios,
  G1_CERTIFICATION_DEFINITION,
  G1_VERIFICATION_DEFINITION,
  EDITORIAL_FIXTURE_HASHES,
} from "./editorial-scenarios.js";

const initial = SCENARIOS.find(
  (scenario) => scenario.kind === "db-state" && scenario.id === "state-final",
);
if (!initial || initial.kind !== "db-state") throw new Error("Core final state checkpoint missing");
const previousState: StateProjection = initial.expect;
const program = editorialScenarios(previousState);
const http = program.filter((scenario): scenario is HttpScenario => scenario.kind === "http");

// These are program-definition tests; only the separate real-PostgreSQL capture can establish
// actual handler success, restricted grants, expected public bytes and mutation isolation.
describe("G1 editorial scenario program", () => {
  it("is a coherent ordered extension with every handler/principal accounted for", () => {
    const base = SCENARIOS.filter((scenario) => !scenario.id.startsWith("editorial-"));
    expect(programProblems([...base, ...program])).toEqual([]);
    expect(new Set(http.map((scenario) => scenario.route))).toEqual(
      new Set(Object.keys(EDITORIAL_ROUTE_MODULES)),
    );
    for (const [route, module] of Object.entries(EDITORIAL_ROUTE_MODULES)) {
      expect(module).toBe(`@/app/${route}/route`);
      expect(readFileSync(resolve("apps/web/src/app", route, "route.ts"), "utf8")).not.toBe("");
      const scenarios = http.filter((scenario) => scenario.route === route);
      expect(new Set(scenarios.map((scenario) => scenario.principal)), route).toEqual(
        new Set(PRINCIPAL_LABELS),
      );
      expect(
        scenarios.some((scenario) => scenario.expect.status === 200),
        route,
      ).toBe(true);
    }
  });

  it("pairs nonempty registry rows with missing controls for all six principals", () => {
    const reads = http.filter((scenario) => scenario.id.includes("-list-"));
    expect(reads).toHaveLength(24);
    for (const read of reads) {
      expect(read.expect.status).toBe(200);
      expect(read.expect.json?.some((check) => "length" in check && check.length === 2)).toBe(true);
      const detail = http.find((scenario) => scenario.id === read.id.replace("-list-", "-detail-"));
      const missing = http.find(
        (scenario) => scenario.id === read.id.replace("-list-", "-missing-"),
      );
      expect(detail?.expect.status).toBe(200);
      expect(missing?.expect.status).toBe(404);
      expect(missing?.expect.denial?.code).toBe("not-found");
    }
  });

  it("uses real targets and valid bodies for role denials, and records exactly three admin audit deltas", () => {
    const writes = http.filter((scenario) => scenario.method === "POST");
    for (const write of writes.filter((scenario) => scenario.principal !== "ADMIN")) {
      expect(write.path).not.toContain("missing");
      expect(write.expect.status).toBe(write.principal === "anonymous" ? 401 : 403);
      expect(write.expect.denial?.message).toBe(
        write.principal === "anonymous" ? "Sign in required." : "Administrator role required.",
      );
    }
    const states = program.filter((scenario) => scenario.kind === "db-state");
    expect(states).toHaveLength(12);
    expect(states.at(-1)?.expect.audit.count).toBe(previousState.audit.count + 3);
    const afterWrites = states.filter((scenario) => scenario.id.endsWith("-after-write"));
    expect(afterWrites.map((scenario) => scenario.expect.audit.count)).toEqual(
      [1, 2, 3].map((n) => previousState.audit.count + n),
    );
    for (const state of states) {
      expect(state.expect.users).toEqual(previousState.users);
      expect(state.expect.notifications).toEqual(previousState.notifications);
      expect(state.expect.certifiers).toEqual(previousState.certifiers);
      expect(state.expect.audit.events).toHaveLength(state.expect.audit.count);
    }
    const repeats = writes.filter((scenario) => scenario.repeatOf !== undefined);
    expect(repeats).toHaveLength(3);
    for (const repeat of repeats) expect(repeat.expect.sameResponseAs).toBe(repeat.repeatOf);
  });

  it("uses valid canonical synthetic definitions and exact SQL digests instead of placeholder contracts", () => {
    const cert = JSON.parse(G1_CERTIFICATION_DEFINITION);
    expect(certificationProtocolDefinitionSchema.parse(cert)).toEqual(cert);
    expect(canonicalJson(cert)).toBe(G1_CERTIFICATION_DEFINITION);
    const verification = JSON.parse(G1_VERIFICATION_DEFINITION);
    expect(
      createVerificationProtocolSchema.safeParse({
        authorityVerifierId: "g1-verifier-editorial",
        seriesKey: "g1-editorial-synthetic",
        protocolVersion: "1.0.0",
        title: "G1 fixture",
        description: "Synthetic fixture only",
        verificationType: "g1-synthetic-fixture",
        executionMode: "deterministic",
        supportedSubjectTypes: ["publication-version"],
        definition: verification,
      }).success,
    ).toBe(true);
    expect(canonicalJson(verification)).toBe(G1_VERIFICATION_DEFINITION);
    const sql = readFileSync(
      resolve("scripts/private-workspace-g1/fixtures/editorial-fixtures.sql"),
      "utf8",
    );
    for (const bytes of [
      G1_CERTIFICATION_DEFINITION,
      G1_VERIFICATION_DEFINITION,
      ...Object.values(EDITORIAL_FIXTURE_HASHES),
    ])
      expect(sql).toContain(bytes);
    expect(sql).not.toMatch(
      /INSERT INTO "(?:CertifierCredential|VerifierCredential|VerificationRun|CertificationRun)"/u,
    );
  });
});
