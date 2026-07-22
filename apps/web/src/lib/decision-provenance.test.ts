import { describe, expect, it } from "vitest";
import { directEditorialDecisionHash, formalEditorialDecisionHash } from "./decision-provenance";

describe("editorial decision provenance hashes", () => {
  const actor = { githubLogin: "editor-snapshot", role: "ADMIN" };
  const conflictOfInterest = { status: "conflict-declared" as const };
  const override = {
    administratorGithubLogin: "editor-snapshot",
    exercisedAt: new Date("2026-07-22T10:00:00.000Z"),
  };

  it("binds direct decisions to subject, actor, role, and override time", () => {
    const base = {
      submissionId: "submission-a",
      actor,
      decision: "accept",
      noteHash: "a".repeat(64),
      conflictOfInterest,
      override,
    };
    const hash = directEditorialDecisionHash(base);
    expect(directEditorialDecisionHash(base)).toBe(hash);
    expect(directEditorialDecisionHash({ ...base, submissionId: "submission-b" })).not.toBe(hash);
    expect(
      directEditorialDecisionHash({
        ...base,
        actor: { ...actor, githubLogin: "renamed-editor" },
      }),
    ).not.toBe(hash);
    expect(directEditorialDecisionHash({ ...base, actor: { ...actor, role: "EDITOR" } })).not.toBe(
      hash,
    );
    expect(
      directEditorialDecisionHash({
        ...base,
        override: { ...override, exercisedAt: new Date("2026-07-22T10:00:01.000Z") },
      }),
    ).not.toBe(hash);
  });

  it("binds formal decisions to both stable subject identifiers", () => {
    const base = {
      roundId: "round-a",
      submissionId: "submission-a",
      actor,
      decision: "accept",
      bodyHash: "b".repeat(64),
      conflictOfInterest,
      override,
    };
    const hash = formalEditorialDecisionHash(base);
    expect(formalEditorialDecisionHash({ ...base, roundId: "round-b" })).not.toBe(hash);
    expect(formalEditorialDecisionHash({ ...base, submissionId: "submission-b" })).not.toBe(hash);
    expect(formalEditorialDecisionHash({ ...base, bodyHash: "c".repeat(64) })).not.toBe(hash);
  });
});
