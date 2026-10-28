export const COMPARISON_STUDY_TASKS = [
  "explain-promise",
  "find-and-compare",
  "inspect-sources-and-evidence",
  "scope-and-source-reuse",
  "copy-and-reopen",
  "source-handoff",
  "review-proposed-relationship",
  "keyboard-source-drilldown",
  "agent-read-only-recipe",
] as const;

export const COMPARISON_STUDY_EVENTS = [
  "comparison-opened",
  "source-context-opened",
  "evidence-opened",
  "references-copied",
  "pair-reopened",
  "help-requested",
  "handoff-opened",
  "task-blocked",
] as const;

const PARTICIPANT_ROLES = [
  "literature-synthesizer",
  "research-lead",
  "researcher-developer",
] as const;
const TASK_OUTCOMES = ["completed", "assisted", "incomplete", "system-blocked"] as const;
const EVENT_SIDES = ["first", "second", "neither"] as const;
const EVENT_RESULTS = ["success", "unavailable", "failed", "not-applicable"] as const;

type TaskId = (typeof COMPARISON_STUDY_TASKS)[number];
type TaskOutcome = (typeof TASK_OUTCOMES)[number];

export interface ComparisonStudyArtifact {
  schemaVersion: "1.0.0";
  studyStatus: "prepared" | "in-progress" | "complete";
  sessions: ComparisonStudySession[];
}

export interface ComparisonStudySession {
  participantId: string;
  role: (typeof PARTICIPANT_ROLES)[number];
  newToOratlas: boolean;
  consentToStructuredObservation: true;
  tasks: ComparisonStudyTask[];
  interpretation: {
    understandsNoScientificConclusion: boolean;
    distinguishesSourceReuseFromIndependentSupport: boolean;
    treatsMissingContextAsUnknown: boolean;
  };
}

export interface ComparisonStudyTask {
  taskId: TaskId;
  outcome: TaskOutcome;
  elapsedSeconds?: number;
  helpRequests: number;
  events: ComparisonStudyEvent[];
}

interface ComparisonStudyEvent {
  code: (typeof COMPARISON_STUDY_EVENTS)[number];
  offsetSeconds: number;
  side: (typeof EVENT_SIDES)[number];
  result: (typeof EVENT_RESULTS)[number];
}

export interface ComparisonStudySummary {
  schemaVersion: "1.0.0";
  studyStatus: ComparisonStudyArtifact["studyStatus"];
  sessionsRecorded: number;
  newToOratlas: number;
  tasks: Record<
    TaskId,
    {
      assigned: number;
      completedUnaided: number;
      completedWithAssistance: number;
      incomplete: number;
      systemBlocked: number;
      medianElapsedSeconds: number | null;
    }
  >;
  interpretation: {
    eligible: number;
    understandsNoScientificConclusion: number;
    distinguishesSourceReuseFromIndependentSupport: number;
    treatsMissingContextAsUnknown: number;
  };
}

export const comparisonStudyArtifactSchema = {
  parse(input: unknown): ComparisonStudyArtifact {
    if (!isArtifact(input)) throw new Error("Invalid comparison study artifact.");
    return input;
  },
  safeParse(
    input: unknown,
  ): { success: true; data: ComparisonStudyArtifact } | { success: false; error: Error } {
    if (isArtifact(input)) return { success: true, data: input };
    return { success: false, error: new Error("Invalid comparison study artifact.") };
  },
};

export function summarizeComparisonStudy(input: unknown): ComparisonStudySummary {
  const artifact = comparisonStudyArtifactSchema.parse(input);
  const tasks = Object.fromEntries(
    COMPARISON_STUDY_TASKS.map((taskId) => {
      const assigned = artifact.sessions.flatMap((session) =>
        session.tasks.filter((task) => task.taskId === taskId),
      );
      const elapsed = assigned
        .flatMap((task) => (task.elapsedSeconds === undefined ? [] : [task.elapsedSeconds]))
        .sort((a, b) => a - b);
      const middle = Math.floor(elapsed.length / 2);
      const medianElapsedSeconds =
        elapsed.length === 0
          ? null
          : elapsed.length % 2 === 0
            ? (elapsed[middle - 1]! + elapsed[middle]!) / 2
            : elapsed[middle]!;
      return [
        taskId,
        {
          assigned: assigned.length,
          completedUnaided: assigned.filter((task) => task.outcome === "completed").length,
          completedWithAssistance: assigned.filter((task) => task.outcome === "assisted").length,
          incomplete: assigned.filter((task) => task.outcome === "incomplete").length,
          systemBlocked: assigned.filter((task) => task.outcome === "system-blocked").length,
          medianElapsedSeconds,
        },
      ];
    }),
  ) as ComparisonStudySummary["tasks"];

  return {
    schemaVersion: artifact.schemaVersion,
    studyStatus: artifact.studyStatus,
    sessionsRecorded: artifact.sessions.length,
    newToOratlas: artifact.sessions.filter((session) => session.newToOratlas).length,
    tasks,
    interpretation: {
      eligible: artifact.sessions.length,
      understandsNoScientificConclusion: artifact.sessions.filter(
        (session) => session.interpretation.understandsNoScientificConclusion,
      ).length,
      distinguishesSourceReuseFromIndependentSupport: artifact.sessions.filter(
        (session) => session.interpretation.distinguishesSourceReuseFromIndependentSupport,
      ).length,
      treatsMissingContextAsUnknown: artifact.sessions.filter(
        (session) => session.interpretation.treatsMissingContextAsUnknown,
      ).length,
    },
  };
}

function isArtifact(input: unknown): input is ComparisonStudyArtifact {
  if (!recordWithKeys(input, ["schemaVersion", "studyStatus", "sessions"])) return false;
  if (
    input.schemaVersion !== "1.0.0" ||
    !["prepared", "in-progress", "complete"].includes(String(input.studyStatus)) ||
    !Array.isArray(input.sessions) ||
    input.sessions.length > 8 ||
    !input.sessions.every(isSession)
  ) {
    return false;
  }
  const ids = input.sessions.map((session) => session.participantId);
  if (new Set(ids).size !== ids.length) return false;
  if (input.studyStatus === "prepared" && input.sessions.length !== 0) return false;
  if (input.studyStatus === "in-progress" && input.sessions.length === 0) return false;
  if (input.studyStatus === "complete" && (input.sessions.length < 5 || input.sessions.length > 8))
    return false;
  return true;
}

function isSession(input: unknown): input is ComparisonStudySession {
  if (
    !recordWithKeys(input, [
      "participantId",
      "role",
      "newToOratlas",
      "consentToStructuredObservation",
      "tasks",
      "interpretation",
    ])
  ) {
    return false;
  }
  const tasks = input.tasks;
  return (
    typeof input.participantId === "string" &&
    /^P0[1-8]$/.test(input.participantId) &&
    isOneOf(input.role, PARTICIPANT_ROLES) &&
    typeof input.newToOratlas === "boolean" &&
    input.consentToStructuredObservation === true &&
    Array.isArray(tasks) &&
    tasks.length <= COMPARISON_STUDY_TASKS.length &&
    tasks.every(isTask) &&
    new Set(tasks.map((task) => task.taskId)).size === tasks.length &&
    recordWithKeys(input.interpretation, [
      "understandsNoScientificConclusion",
      "distinguishesSourceReuseFromIndependentSupport",
      "treatsMissingContextAsUnknown",
    ]) &&
    Object.values(input.interpretation).every((value) => typeof value === "boolean")
  );
}

function isTask(input: unknown): input is ComparisonStudyTask {
  if (!recordWithKeys(input, ["taskId", "outcome", "helpRequests", "events"], ["elapsedSeconds"]))
    return false;
  return (
    isOneOf(input.taskId, COMPARISON_STUDY_TASKS) &&
    isOneOf(input.outcome, TASK_OUTCOMES) &&
    Number.isInteger(input.helpRequests) &&
    (input.helpRequests as number) >= 0 &&
    (input.outcome !== "completed" || input.helpRequests === 0) &&
    (input.outcome !== "assisted" || (input.helpRequests as number) > 0) &&
    (input.elapsedSeconds === undefined || isBoundedInteger(input.elapsedSeconds, 0, 3600)) &&
    Array.isArray(input.events) &&
    input.events.every(isEvent)
  );
}

function isEvent(input: unknown): input is ComparisonStudyEvent {
  return (
    recordWithKeys(input, ["code", "offsetSeconds", "side", "result"]) &&
    isOneOf(input.code, COMPARISON_STUDY_EVENTS) &&
    isBoundedInteger(input.offsetSeconds, 0, 3600) &&
    isOneOf(input.side, EVENT_SIDES) &&
    isOneOf(input.result, EVENT_RESULTS)
  );
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function recordWithKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key))
  );
}
