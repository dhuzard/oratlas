/**
 * Frozen, inert synthetic scenario for the local effect-ordering fixture
 * (docs/local-synthetic-alpha-ordering.md). A scenario is plain data only: fixed domains, fixed
 * case ids, scripted store/provider outcomes, named gated stages and a fixed response body. It
 * cannot carry functions, getters, URLs, credentials or callbacks; `createHarness` accepts only a
 * scenario branded by `defineSyntheticScenario`, which validates and deep-freezes it first.
 *
 * Synthetic only: no real user, collaborator, workspace or provider identifier belongs here.
 */

/** The fixed, independent synthetic authorization domains. */
export const SYNTHETIC_DOMAINS = ["alpha", "beta"] as const;
export type SyntheticDomain = (typeof SYNTHETIC_DOMAINS)[number];

/** Scripted result of the inert synthetic store resolution for one operation. */
export type StoreOutcome = "allow" | "deny" | "error";
/** Stages at which an operation waits on a named, test-opened barrier. */
export type GatedStage = "store" | "pre-boundary" | "completion";
/**
 * Fixed transport fault injected at the HTTP effect boundary (the only way a scenario influences the
 * transport): `end-throws-after-end` simulates a throw that follows a possibly partial hand-off;
 * `socket-destroyed-at-handoff` destroys the socket after hand-off is attempted, before `end`.
 */
export type TransportFault = "none" | "end-throws-after-end" | "socket-destroyed-at-handoff";

export interface HttpCase {
  readonly kind: "http";
  readonly domain: SyntheticDomain;
  readonly store: StoreOutcome;
  readonly gated: readonly GatedStage[];
  readonly body: string;
  readonly transportFault: TransportFault;
}

export interface ProviderCase {
  readonly kind: "provider";
  readonly domain: SyntheticDomain;
  readonly store: StoreOutcome;
  readonly gated: readonly GatedStage[];
  readonly completion: "ok" | "error";
  readonly job: string;
}

export type SyntheticCase = HttpCase | ProviderCase;

export interface SyntheticScenario {
  readonly name: string;
  readonly cases: Readonly<Record<string, SyntheticCase>>;
}

export class SyntheticScenarioError extends Error {
  override readonly name = "SyntheticScenarioError";
}

const CASE_ID = /^[a-z][a-z0-9-]{0,47}$/u;
/** Printable ASCII only, bounded: response bodies and job labels are fixed fixture text. */
const FIXED_TEXT = /^[\x20-\x7e]{1,200}$/u;
const STORE_OUTCOMES: readonly string[] = ["allow", "deny", "error"];
const FAULTS: readonly string[] = ["none", "end-throws-after-end", "socket-destroyed-at-handoff"];
const HTTP_STAGES: readonly string[] = ["store", "pre-boundary"];
const PROVIDER_STAGES: readonly string[] = ["store", "pre-boundary", "completion"];
const BRANDED = new WeakSet<object>();

function fail(message: string): never {
  throw new SyntheticScenarioError(message);
}

/**
 * Validation never performs an ordinary property read (`[[Get]]`) on caller input: every own key
 * and descriptor is inspected first and values are taken from data descriptors only, so a getter
 * is rejected without being invoked. This covers ordinary objects and arrays; a `Proxy` can still
 * run its traps during inspection, and arbitrary JavaScript is not sandboxed.
 */
function inertValue(descriptor: PropertyDescriptor | undefined, where: string): unknown {
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    descriptor.enumerable !== true ||
    typeof descriptor.value === "function"
  ) {
    fail(`${where} must be inert data`);
  }
  return descriptor.value;
}

/**
 * A plain data record: ordinary prototype, own enumerable string-keyed data properties only, keys
 * accepted by `allowKey`. Returns a null-prototype snapshot of the descriptor values.
 */
function plainEntries(
  value: unknown,
  allowKey: (key: string) => boolean,
  where: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} must be a plain object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(`${where} must be a plain object`);
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowKey(key)) fail(`${where} has unknown key`);
    snapshot[key] = inertValue(Object.getOwnPropertyDescriptor(value, key), `${where}.${key}`);
  }
  return snapshot;
}

/** A plain data record with exactly `keys`. */
function plainRecord(
  value: unknown,
  keys: readonly string[],
  where: string,
): Record<string, unknown> {
  const snapshot = plainEntries(value, (key) => keys.includes(key), where);
  for (const key of keys) if (!Object.hasOwn(snapshot, key)) fail(`${where}.${key} is required`);
  return snapshot;
}

/**
 * A dense, ordinary array of at most `max` elements: `Array.prototype`, own keys exactly the
 * indices `0..length-1` plus `length`, no holes, symbols or extra properties, every element an
 * enumerable data property. Returns a copy of the descriptor values.
 */
function plainArray(value: unknown, max: number, where: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${where} must be an array`);
  }
  const length: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > max) {
    fail(`${where} is too long`);
  }
  // `length` plus `length` distinct present indices must account for every own key.
  if (Reflect.ownKeys(value).length !== length + 1) {
    fail(`${where} must be a dense array without extra properties`);
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    result.push(inertValue(Object.getOwnPropertyDescriptor(value, index), `${where}[${index}]`));
  }
  return result;
}

function oneOf(value: unknown, allowed: readonly string[], where: string): string {
  if (typeof value !== "string" || !allowed.includes(value)) fail(`${where} is not allowed`);
  return value;
}

function fixedText(value: unknown, where: string): string {
  if (typeof value !== "string" || !FIXED_TEXT.test(value)) fail(`${where} must be fixed ASCII`);
  return value;
}

function stages(value: unknown, allowed: readonly string[], where: string): GatedStage[] {
  const elements = plainArray(value, allowed.length, where);
  const result: GatedStage[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const stage = oneOf(elements[index], allowed, `${where}[${index}]`) as GatedStage;
    if (result.includes(stage)) fail(`${where} repeats ${stage}`);
    result.push(stage);
  }
  return result;
}

function validateCase(id: string, value: unknown): SyntheticCase {
  const where = `cases.${id}`;
  if (!CASE_ID.test(id)) fail(`${where}: invalid case id`);
  // Read the discriminator through its descriptor so an accessor is never invoked.
  const kind =
    typeof value === "object" && value !== null
      ? Object.getOwnPropertyDescriptor(value, "kind")?.value
      : undefined;
  if (kind === "http") {
    const record = plainRecord(
      value,
      ["kind", "domain", "store", "gated", "body", "transportFault"],
      where,
    );
    return Object.freeze({
      kind: "http",
      domain: oneOf(record.domain, SYNTHETIC_DOMAINS, `${where}.domain`) as SyntheticDomain,
      store: oneOf(record.store, STORE_OUTCOMES, `${where}.store`) as StoreOutcome,
      gated: Object.freeze(stages(record.gated, HTTP_STAGES, `${where}.gated`)),
      body: fixedText(record.body, `${where}.body`),
      transportFault: oneOf(
        record.transportFault,
        FAULTS,
        `${where}.transportFault`,
      ) as TransportFault,
    });
  }
  if (kind === "provider") {
    const record = plainRecord(
      value,
      ["kind", "domain", "store", "gated", "completion", "job"],
      where,
    );
    return Object.freeze({
      kind: "provider",
      domain: oneOf(record.domain, SYNTHETIC_DOMAINS, `${where}.domain`) as SyntheticDomain,
      store: oneOf(record.store, STORE_OUTCOMES, `${where}.store`) as StoreOutcome,
      gated: Object.freeze(stages(record.gated, PROVIDER_STAGES, `${where}.gated`)),
      completion: oneOf(record.completion, ["ok", "error"], `${where}.completion`) as
        "ok" | "error",
      job: fixedText(record.job, `${where}.job`),
    });
  }
  return fail(`${where}.kind is not allowed`);
}

/**
 * Validate inert scenario data, copy it into deep-frozen records and brand the copy. The input is
 * never retained, so later mutation of the caller's object cannot reach a harness.
 */
export function defineSyntheticScenario(input: unknown): SyntheticScenario {
  const record = plainRecord(input, ["name", "cases"], "scenario");
  const name = fixedText(record.name, "scenario.name");
  const rawCases = plainEntries(record.cases, () => true, "scenario.cases");
  const cases: Record<string, SyntheticCase> = Object.create(null);
  for (const id of Object.keys(rawCases)) cases[id] = validateCase(id, rawCases[id]);
  if (Object.keys(cases).length === 0) fail("scenario.cases must not be empty");
  const scenario: SyntheticScenario = Object.freeze({ name, cases: Object.freeze(cases) });
  BRANDED.add(scenario);
  return scenario;
}

export function isBrandedSyntheticScenario(value: unknown): value is SyntheticScenario {
  return typeof value === "object" && value !== null && BRANDED.has(value);
}

/** The fixed scenario the local alpha fixture and its tests use. Every value is synthetic. */
export const SYNTHETIC_ALPHA_SCENARIO = defineSyntheticScenario({
  name: "local-synthetic-alpha-ordering",
  cases: {
    "alpha-read": {
      kind: "http",
      domain: "alpha",
      store: "allow",
      gated: ["store"],
      body: "synthetic alpha record",
      transportFault: "none",
    },
    "alpha-read-open": {
      kind: "http",
      domain: "alpha",
      store: "allow",
      gated: [],
      body: "synthetic alpha record",
      transportFault: "none",
    },
    "alpha-read-preboundary": {
      kind: "http",
      domain: "alpha",
      store: "allow",
      gated: ["pre-boundary"],
      body: "synthetic alpha record",
      transportFault: "none",
    },
    "alpha-read-store-deny": {
      kind: "http",
      domain: "alpha",
      store: "deny",
      gated: [],
      body: "synthetic alpha record",
      transportFault: "none",
    },
    "alpha-read-store-error": {
      kind: "http",
      domain: "alpha",
      store: "error",
      gated: ["store"],
      body: "synthetic alpha record",
      transportFault: "none",
    },
    "alpha-read-end-throws": {
      kind: "http",
      domain: "alpha",
      store: "allow",
      gated: [],
      body: "synthetic alpha record",
      transportFault: "end-throws-after-end",
    },
    "alpha-read-socket-destroyed": {
      kind: "http",
      domain: "alpha",
      store: "allow",
      gated: [],
      body: "synthetic alpha record",
      transportFault: "socket-destroyed-at-handoff",
    },
    "alpha-provider": {
      kind: "provider",
      domain: "alpha",
      store: "allow",
      gated: ["store", "completion"],
      completion: "ok",
      job: "synthetic alpha job",
    },
    "alpha-provider-fails": {
      kind: "provider",
      domain: "alpha",
      store: "allow",
      gated: ["completion"],
      completion: "error",
      job: "synthetic alpha job",
    },
    "alpha-provider-store-error": {
      kind: "provider",
      domain: "alpha",
      store: "error",
      gated: [],
      completion: "ok",
      job: "synthetic alpha job",
    },
    "beta-read": {
      kind: "http",
      domain: "beta",
      store: "allow",
      gated: [],
      body: "synthetic beta record",
      transportFault: "none",
    },
  },
});
