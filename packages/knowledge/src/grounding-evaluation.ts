import { Buffer } from "node:buffer";
import { canonicalJson, SYNTHESIS_REVIEW_LIMITS } from "@oratlas/contracts";
import type { LlmJsonCompletionRequest, LlmProvider } from "./discuss.js";
import type { PreparedSubgraphEvidencePacket } from "./subgraph-evidence.js";
import {
  assertCanonicalPreparedPacket,
  buildSynthesisCompletionRequest,
  composeDeterministicSynthesis,
  parseAndValidateSynthesisOutput,
  SynthesisWriterError,
  SYNTHESIS_SYSTEM_PROMPT,
  SYNTHESIS_WRITER_ERROR_CODES,
  type SynthesisWriterErrorCode,
} from "./synthesis-writer.js";

export const GROUNDING_EVAL_REPORT_VERSION = "1.0.0" as const;
export const GROUNDING_EVAL_RUNNER_VERSION = "grounding-eval/1.0.0" as const;

export const GROUNDING_EVAL_LIMITS = {
  maxFixtures: 100,
  maxFixtureIdCharacters: 80,
  maxFixtureBytes: 1_500_000,
  maxRequestAssertions: 20,
  maxAssertionCharacters: 2_000,
  maxRealProviderTimeoutMs: 30_000,
} as const;

export type GroundingEvalExpectedOutcome = "accepted" | "rejected";
export type GroundingEvalObservedOutcome = GroundingEvalExpectedOutcome | "operational-error";
export type GroundingEvalMode = "mock" | "real";

export const GROUNDING_EVAL_OPERATIONAL_ERROR_CODES = [
  "fixture-invalid",
  "fixture-overflow",
  "provider-failed",
  "request-invariant-failed",
  "fallback-invariant-failed",
] as const;
export type GroundingEvalOperationalErrorCode =
  (typeof GROUNDING_EVAL_OPERATIONAL_ERROR_CODES)[number];

export interface GroundingEvalRequestAssertions {
  /** Bounded inert strings that must occur in the canonical user-data packet. */
  userIncludes?: readonly string[];
  /** The same strings must never be interpolated into the static system prompt. */
  systemExcludes?: readonly string[];
}

export interface GroundingEvalFixture {
  id: string;
  prepared: PreparedSubgraphEvidencePacket;
  expectedOutcome: GroundingEvalExpectedOutcome;
  expectedErrorCode?: SynthesisWriterErrorCode;
  realEligible: boolean;
  mockResponse: (prepared: PreparedSubgraphEvidencePacket) => string;
  requestAssertions?: GroundingEvalRequestAssertions;
}

/**
 * Typed one-file fixture declaration. Discovery belongs to the CLI; the
 * knowledge package intentionally has no filesystem, environment, or clock I/O.
 */
export function defineGroundingEvalFixture<const Fixture extends GroundingEvalFixture>(
  fixture: Fixture,
): Fixture {
  return Object.freeze(fixture);
}

export interface GroundingEvalCaseResult {
  id: string;
  passed: boolean;
  expectedOutcome: GroundingEvalExpectedOutcome;
  observedOutcome: GroundingEvalObservedOutcome;
  errorCode?: SynthesisWriterErrorCode | GroundingEvalOperationalErrorCode;
}

export interface GroundingEvalReport {
  schemaVersion: typeof GROUNDING_EVAL_REPORT_VERSION;
  runnerVersion: typeof GROUNDING_EVAL_RUNNER_VERSION;
  mode: GroundingEvalMode;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  cases: GroundingEvalCaseResult[];
}

export interface GroundingEvalOptions {
  mode?: GroundingEvalMode;
  /** Required only for explicit real-provider evaluation. Called sequentially once per case. */
  provider?: LlmProvider;
}

export class GroundingEvalFixtureError extends Error {
  readonly code: "fixture-invalid" | "fixture-overflow";

  constructor(code: GroundingEvalFixtureError["code"]) {
    super(
      code === "fixture-overflow"
        ? "Grounding fixture bounds exceeded."
        : "Grounding fixture is invalid.",
    );
    this.name = "GroundingEvalFixtureError";
    this.code = code;
  }
}

class ScriptedProvider implements LlmProvider {
  readonly name = "grounding-eval-scripted";
  readonly model = "scripted-json-1.0";
  readonly requests: LlmJsonCompletionRequest[] = [];

  constructor(private readonly response: string) {}

  async complete(request: LlmJsonCompletionRequest): Promise<string> {
    this.requests.push({ ...request });
    return this.response;
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fixtureStrings(assertions: GroundingEvalRequestAssertions | undefined): string[] {
  return [...(assertions?.userIncludes ?? []), ...(assertions?.systemExcludes ?? [])];
}

interface PreparedGroundingEvalFixture {
  fixture: GroundingEvalFixture;
  prepared: PreparedSubgraphEvidencePacket;
  mockResponse: string;
}

function assertFixtureShape(fixture: GroundingEvalFixture): PreparedGroundingEvalFixture {
  if (
    typeof fixture.id !== "string" ||
    !/^[a-z0-9][a-z0-9-]*$/.test(fixture.id) ||
    fixture.id.length > GROUNDING_EVAL_LIMITS.maxFixtureIdCharacters ||
    typeof fixture.realEligible !== "boolean" ||
    typeof fixture.mockResponse !== "function" ||
    (fixture.expectedOutcome !== "accepted" && fixture.expectedOutcome !== "rejected") ||
    (fixture.expectedErrorCode !== undefined &&
      !SYNTHESIS_WRITER_ERROR_CODES.includes(fixture.expectedErrorCode))
  ) {
    throw new GroundingEvalFixtureError("fixture-invalid");
  }
  if (
    fixture.expectedOutcome === "accepted"
      ? fixture.expectedErrorCode !== undefined
      : !fixture.expectedErrorCode
  ) {
    throw new GroundingEvalFixtureError("fixture-invalid");
  }
  const assertionStrings = fixtureStrings(fixture.requestAssertions);
  if (
    assertionStrings.length > GROUNDING_EVAL_LIMITS.maxRequestAssertions ||
    assertionStrings.some(
      (value) => value.length < 1 || value.length > GROUNDING_EVAL_LIMITS.maxAssertionCharacters,
    )
  ) {
    throw new GroundingEvalFixtureError("fixture-overflow");
  }

  let prepared: PreparedSubgraphEvidencePacket;
  let response: string;
  try {
    prepared = assertCanonicalPreparedPacket(fixture.prepared);
    response = fixture.mockResponse(prepared);
  } catch (error) {
    if (error instanceof GroundingEvalFixtureError) throw error;
    throw new GroundingEvalFixtureError("fixture-invalid");
  }
  if (typeof response !== "string") throw new GroundingEvalFixtureError("fixture-invalid");
  const fixtureBytes =
    Buffer.byteLength(prepared.json, "utf8") +
    Buffer.byteLength(response, "utf8") +
    assertionStrings.reduce((total, value) => total + Buffer.byteLength(value, "utf8"), 0);
  if (
    fixtureBytes > GROUNDING_EVAL_LIMITS.maxFixtureBytes ||
    Buffer.byteLength(response, "utf8") > SYNTHESIS_REVIEW_LIMITS.maxOutputBytes
  ) {
    throw new GroundingEvalFixtureError("fixture-overflow");
  }
  return { fixture, prepared, mockResponse: response };
}

function materializeGroundingEvalFixtures(
  fixtures: readonly GroundingEvalFixture[],
  mode: GroundingEvalMode,
): PreparedGroundingEvalFixture[] {
  if (fixtures.length < 1) throw new GroundingEvalFixtureError("fixture-invalid");
  if (fixtures.length > GROUNDING_EVAL_LIMITS.maxFixtures) {
    throw new GroundingEvalFixtureError("fixture-overflow");
  }
  const selected = fixtures
    .filter((fixture) => mode === "mock" || fixture.realEligible)
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  if (selected.length < 1) throw new GroundingEvalFixtureError("fixture-invalid");
  if (new Set(selected.map((fixture) => fixture.id)).size !== selected.length) {
    throw new GroundingEvalFixtureError("fixture-invalid");
  }
  return selected.map(assertFixtureShape);
}

/** Validate all fixture metadata before any provider can be called. */
export function prepareGroundingEvalFixtures(
  fixtures: readonly GroundingEvalFixture[],
  mode: GroundingEvalMode,
): GroundingEvalFixture[] {
  return materializeGroundingEvalFixtures(fixtures, mode).map((entry) => entry.fixture);
}

function requestInvariantHolds(
  captured: readonly LlmJsonCompletionRequest[],
  expected: LlmJsonCompletionRequest,
  assertions: GroundingEvalRequestAssertions | undefined,
): boolean {
  if (captured.length !== 1) return false;
  const request = captured[0]!;
  if (
    request.system !== SYNTHESIS_SYSTEM_PROMPT ||
    canonicalJson(request) !== canonicalJson(expected)
  ) {
    return false;
  }
  return (
    (assertions?.userIncludes ?? []).every((value) => request.user.includes(value)) &&
    (assertions?.systemExcludes ?? []).every((value) => !request.system.includes(value))
  );
}

function matchesExpected(
  fixture: GroundingEvalFixture,
  observedOutcome: GroundingEvalObservedOutcome,
  errorCode?: SynthesisWriterErrorCode | GroundingEvalOperationalErrorCode,
): boolean {
  if (observedOutcome !== fixture.expectedOutcome) return false;
  return fixture.expectedOutcome === "accepted" || errorCode === fixture.expectedErrorCode;
}

async function evaluateFixture(
  entry: PreparedGroundingEvalFixture,
  mode: GroundingEvalMode,
  realProvider?: LlmProvider,
): Promise<GroundingEvalCaseResult> {
  const { fixture, prepared } = entry;
  const expectedRequest = buildSynthesisCompletionRequest(prepared);

  // The deterministic no-provider composer is always exercised through the
  // exact same production parser and grounding validator as provider output.
  try {
    const fallback = composeDeterministicSynthesis(prepared);
    parseAndValidateSynthesisOutput(canonicalJson(fallback), prepared.packet);
  } catch {
    return {
      id: fixture.id,
      passed: false,
      expectedOutcome: fixture.expectedOutcome,
      observedOutcome: "operational-error",
      errorCode: "fallback-invariant-failed",
    };
  }

  let provider: LlmProvider;
  let captured: readonly LlmJsonCompletionRequest[];
  if (mode === "mock") {
    const scripted = new ScriptedProvider(entry.mockResponse);
    provider = scripted;
    captured = scripted.requests;
  } else {
    if (!realProvider) {
      return {
        id: fixture.id,
        passed: false,
        expectedOutcome: fixture.expectedOutcome,
        observedOutcome: "operational-error",
        errorCode: "provider-failed",
      };
    }
    const requests: LlmJsonCompletionRequest[] = [];
    provider = {
      name: realProvider.name,
      model: realProvider.model,
      modelVersion: realProvider.modelVersion,
      async complete(request) {
        requests.push({ ...request });
        return realProvider.complete(request);
      },
    };
    captured = requests;
  }

  let raw: string;
  try {
    raw = await provider.complete(expectedRequest);
  } catch {
    return {
      id: fixture.id,
      passed: false,
      expectedOutcome: fixture.expectedOutcome,
      observedOutcome: "operational-error",
      errorCode: "provider-failed",
    };
  }
  if (!requestInvariantHolds(captured, expectedRequest, fixture.requestAssertions)) {
    return {
      id: fixture.id,
      passed: false,
      expectedOutcome: fixture.expectedOutcome,
      observedOutcome: "operational-error",
      errorCode: "request-invariant-failed",
    };
  }

  let observedOutcome: GroundingEvalObservedOutcome = "accepted";
  let errorCode: SynthesisWriterErrorCode | undefined;
  try {
    parseAndValidateSynthesisOutput(raw, prepared.packet);
  } catch (error) {
    if (!(error instanceof SynthesisWriterError)) {
      return {
        id: fixture.id,
        passed: false,
        expectedOutcome: fixture.expectedOutcome,
        observedOutcome: "operational-error",
        errorCode: "provider-failed",
      };
    }
    observedOutcome = "rejected";
    errorCode = error.code;
  }
  return {
    id: fixture.id,
    passed: matchesExpected(fixture, observedOutcome, errorCode),
    expectedOutcome: fixture.expectedOutcome,
    observedOutcome,
    ...(errorCode ? { errorCode } : {}),
  };
}

/**
 * Sequential, deterministic grounding evaluation. The returned report is a
 * privacy-safe value object: it contains no packets, prompts, output, hashes,
 * exception text, timestamps, environment values, or AgentRun records.
 */
export async function evaluateGroundingFixtures(
  fixtures: readonly GroundingEvalFixture[],
  options: GroundingEvalOptions = {},
): Promise<GroundingEvalReport> {
  const mode = options.mode ?? "mock";
  const selected = materializeGroundingEvalFixtures(fixtures, mode);
  const cases: GroundingEvalCaseResult[] = [];
  for (const fixture of selected) {
    cases.push(await evaluateFixture(fixture, mode, options.provider));
  }
  const passed = cases.filter((result) => result.passed).length;
  return {
    schemaVersion: GROUNDING_EVAL_REPORT_VERSION,
    runnerVersion: GROUNDING_EVAL_RUNNER_VERSION,
    mode,
    summary: { total: cases.length, passed, failed: cases.length - passed },
    cases,
  };
}
