import { canonicalJson, type ConflictOfInterestSnapshot } from "@oratlas/contracts";
import { sha256 } from "./hash";

interface ActorSnapshot {
  githubLogin: string;
  role: string;
}

interface OverrideSnapshot {
  administratorGithubLogin: string;
  exercisedAt: Date | string;
}

function overrideValue(override: OverrideSnapshot | null) {
  return override
    ? {
        administrator: { githubLogin: override.administratorGithubLogin },
        exercisedAt:
          typeof override.exercisedAt === "string"
            ? new Date(override.exercisedAt).toISOString()
            : override.exercisedAt.toISOString(),
      }
    : null;
}

export function directEditorialDecisionHash(input: {
  submissionId: string;
  actor: ActorSnapshot;
  decision: string;
  noteHash: string | null;
  conflictOfInterest: ConflictOfInterestSnapshot;
  override: OverrideSnapshot | null;
}): string {
  return sha256(
    canonicalJson({
      subject: { submissionId: input.submissionId },
      actor: input.actor,
      decision: input.decision,
      noteHash: input.noteHash,
      conflictOfInterest: input.conflictOfInterest,
      administratorOverride: overrideValue(input.override),
    }),
  );
}

export function formalEditorialDecisionHash(input: {
  roundId: string;
  submissionId: string;
  actor: ActorSnapshot;
  decision: string;
  bodyHash: string;
  conflictOfInterest: ConflictOfInterestSnapshot;
  override: OverrideSnapshot | null;
}): string {
  return sha256(
    canonicalJson({
      subject: { roundId: input.roundId, submissionId: input.submissionId },
      actor: input.actor,
      decision: input.decision,
      bodyHash: input.bodyHash,
      conflictOfInterest: input.conflictOfInterest,
      administratorOverride: overrideValue(input.override),
    }),
  );
}
