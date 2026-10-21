import { workerCredential } from "./worker-authority.js";
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "./scenarios.js";
import { captureFromGolden } from "./test-support.js";
import {
  supplementalCandidate,
  supplementalCountsProblems,
  supplementalCountsSql,
  supplementalGoldenProblems,
  supplementalPairProblems,
  type SupplementalProgram,
} from "./supplemental-channel.js";
const program: SupplementalProgram = {
  name: "test-public-read",
  spec: "public-routes.g1.spec.ts",
  outVariable: "G1_CAPTURE_OUT",
  scenarios: SCENARIOS.filter((s) => s.id === "openapi-json"),
  addedRows: {},
  stateSuffix: ".states.json",
};
const evidence = () => ({
  capture: {
    ...captureFromGolden("baseline"),
    records: captureFromGolden("baseline").records.filter((r) => r.id === "openapi-json"),
  },
  state: {
    initial: { User: [{ id: "synthetic", updatedAt: "2026-04-01T00:00:00Z" }] },
    states: [],
  },
});
describe("independently reviewed supplemental programs", () => {
  it("refuses a worker capability in state before producing any candidate", () => {
    const original = evidence();
    expect(() =>
      supplementalCandidate(
        program,
        { ...original, state: { unexpected: workerCredential("verifier", "active").token } },
        "unit control",
      ),
    ).toThrow("Worker capability state disclosure refused");
  });
  it("binds the program, outcomes, exact HTTP and complete native state to its own golden", () => {
    const original = evidence();
    const golden = supplementalCandidate(program, original, "unit-test control only");
    expect(supplementalGoldenProblems(program, original, golden)).toEqual([]);
    expect(supplementalGoldenProblems({ ...program, name: "other" }, original, golden)).toContain(
      "Invalid reviewed supplemental golden",
    );
    const changed = evidence();
    changed.state.initial.User[0]!.updatedAt = "2026-04-01T00:00:01Z";
    expect(supplementalGoldenProblems(program, changed, golden)).toContain(
      "Complete supplemental state differs from reviewed golden",
    );
    expect(supplementalPairProblems(original, changed)).toContain(
      "Complete supplemental state evidence differs",
    );
    const statusChanged = evidence();
    statusChanged.capture.records = statusChanged.capture.records.map((r) =>
      r.kind === "http" ? { ...r, status: 500 } : r,
    );
    expect(supplementalGoldenProblems(program, statusChanged, golden).length).toBeGreaterThan(0);
  });
  it("counts every recorded table without granting runtime access or accepting SQL identifiers", () => {
    const sql = supplementalCountsSql(["SynthesisGenerationRequestClaim", "User"]);
    expect(sql).toContain('FROM public."SynthesisGenerationRequestClaim"');
    expect(sql).toContain('FROM public."User"');
    expect(sql).not.toContain("GRANT");
    expect(() => supplementalCountsSql([])).toThrow();
    expect(() => supplementalCountsSql(["User", "User"])).toThrow();
    expect(() => supplementalCountsSql(['User"; DROP TABLE User; --'])).toThrow();
  });
  it("rejects undeclared count changes and omitted tables, including zero-valued deltas", () => {
    const base = { Review: 3, User: 5 };
    expect(supplementalCountsProblems(base, { Review: 4, User: 5 }, { Review: 1 })).toEqual([]);
    expect(supplementalCountsProblems(base, { Review: 4, User: 6 }, { Review: 1 })).toContain(
      "Supplemental row count differs: User",
    );
    expect(supplementalCountsProblems(base, { Review: 4 }, { Review: 1 })).toContain(
      "Supplemental row count differs: User",
    );
    expect(supplementalCountsProblems(base, base, { Unreviewed: 0 })).toContain(
      "Supplemental row count differs: Unreviewed",
    );
    expect(supplementalCountsProblems(base, base, { Review: -1 })).toContain(
      "Supplemental row count differs: Review",
    );
  });
});
