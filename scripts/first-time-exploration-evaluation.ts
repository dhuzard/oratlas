export interface FirstTimeExplorationStudy {
  protocolVersion: "1.0.0";
  sessions: FirstTimeExplorationSession[];
}

interface FirstTimeExplorationSession {
  participantId: string;
  centralPromise: {
    scientificClaim: boolean;
    linkedEvidence: boolean;
    independentAssessmentOrDisagreement: boolean;
    originalRecordPreserved: boolean;
  };
  reachedPersonalizedLandscape: boolean;
  distinguished: {
    review: boolean;
    claim: boolean;
    evidence: boolean;
    assessment: boolean;
    disagreement: boolean;
  };
  returnedToOverview: boolean;
  keyboardAttempt?: { completed: boolean };
}

export const firstTimeExplorationStudySchema = {
  parse(input: unknown): FirstTimeExplorationStudy {
    if (!isStudy(input)) throw new Error("Invalid first-time exploration study.");
    return input;
  },
  safeParse(
    input: unknown,
  ): { success: true; data: FirstTimeExplorationStudy } | { success: false; error: Error } {
    if (isStudy(input)) return { success: true, data: input };
    return { success: false, error: new Error("Invalid first-time exploration study.") };
  },
};

export interface ExplorationEvaluationSummary {
  protocolVersion: "1.0.0";
  completedSessions: number;
  outcomes: {
    centralPromiseRecognized: EvaluationMetric;
    personalizedLandscapeReached: EvaluationMetric;
    recordKindsDistinguished: EvaluationMetric;
    overviewReturnCompleted: EvaluationMetric;
    keyboardJourneyCompleted: EvaluationMetric & { attempted: number };
  };
}

interface EvaluationMetric {
  passed: number;
  eligible: number;
  rate: number | null;
}

export function summarizeFirstTimeExploration(input: unknown): ExplorationEvaluationSummary {
  const study = firstTimeExplorationStudySchema.parse(input);
  const promisePassed = study.sessions.filter((session) =>
    Object.values(session.centralPromise).every(Boolean),
  ).length;
  const landscapePassed = study.sessions.filter(
    (session) => session.reachedPersonalizedLandscape,
  ).length;
  const kindsPassed = study.sessions.filter((session) =>
    Object.values(session.distinguished).every(Boolean),
  ).length;
  const returnPassed = study.sessions.filter((session) => session.returnedToOverview).length;
  const keyboardAttempts = study.sessions.filter((session) => session.keyboardAttempt);
  const keyboardPassed = keyboardAttempts.filter(
    (session) => session.keyboardAttempt?.completed,
  ).length;
  const completedSessions = study.sessions.length;

  return {
    protocolVersion: study.protocolVersion,
    completedSessions,
    outcomes: {
      centralPromiseRecognized: metric(promisePassed, completedSessions),
      personalizedLandscapeReached: metric(landscapePassed, completedSessions),
      recordKindsDistinguished: metric(kindsPassed, completedSessions),
      overviewReturnCompleted: metric(returnPassed, completedSessions),
      keyboardJourneyCompleted: {
        ...metric(keyboardPassed, keyboardAttempts.length),
        attempted: keyboardAttempts.length,
      },
    },
  };
}

function metric(passed: number, eligible: number): EvaluationMetric {
  return { passed, eligible, rate: eligible === 0 ? null : passed / eligible };
}

function isStudy(input: unknown): input is FirstTimeExplorationStudy {
  if (!isRecordWithKeys(input, ["protocolVersion", "sessions"])) return false;
  const participantIds = Array.isArray(input.sessions)
    ? input.sessions
        .filter(
          (session): session is Record<string, unknown> =>
            typeof session === "object" && session !== null,
        )
        .map((session) => session.participantId)
    : [];
  return (
    input.protocolVersion === "1.0.0" &&
    Array.isArray(input.sessions) &&
    input.sessions.length >= 1 &&
    input.sessions.length <= 50 &&
    input.sessions.every(isSession) &&
    new Set(participantIds).size === input.sessions.length
  );
}

function isSession(input: unknown): input is FirstTimeExplorationSession {
  if (
    !isRecordWithKeys(
      input,
      [
        "participantId",
        "centralPromise",
        "reachedPersonalizedLandscape",
        "distinguished",
        "returnedToOverview",
        "keyboardAttempt",
      ],
      ["keyboardAttempt"],
    )
  ) {
    return false;
  }
  return (
    typeof input.participantId === "string" &&
    /^P\d{2,4}$/.test(input.participantId) &&
    isBooleanRecord(input.centralPromise, [
      "scientificClaim",
      "linkedEvidence",
      "independentAssessmentOrDisagreement",
      "originalRecordPreserved",
    ]) &&
    typeof input.reachedPersonalizedLandscape === "boolean" &&
    isBooleanRecord(input.distinguished, [
      "review",
      "claim",
      "evidence",
      "assessment",
      "disagreement",
    ]) &&
    typeof input.returnedToOverview === "boolean" &&
    (input.keyboardAttempt === undefined ||
      (isRecordWithKeys(input.keyboardAttempt, ["completed"]) &&
        typeof input.keyboardAttempt.completed === "boolean"))
  );
}

function isBooleanRecord(input: unknown, keys: string[]): input is Record<string, boolean> {
  return isRecordWithKeys(input, keys) && keys.every((key) => typeof input[key] === "boolean");
}

function isRecordWithKeys(
  input: unknown,
  keys: string[],
  optionalKeys: string[] = [],
): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const actualKeys = Object.keys(input);
  const allowedKeys = new Set(keys);
  const requiredKeys = keys.filter((key) => !optionalKeys.includes(key));
  return (
    actualKeys.every((key) => allowedKeys.has(key)) &&
    requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(input, key))
  );
}
