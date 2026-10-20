import { z } from "zod";

/**
 * Identity-link foundations (#203, ORA-203). An internal, pure orchestrator for proving that the
 * current local principal controls an external identifier in one allowlisted namespace.
 *
 * Nothing imports this module yet. It is not an OAuth client, it calls no endpoint and it assumes
 * no PKCE or ORCID behaviour. The only output is an identifier-control link decision, never a
 * login, grant, membership, authorship or credit (ADR-0001 §4.2). Every collaborator is injected
 * and every collaborator result is validated here; any malformed result or exception fails closed.
 * See `docs/identity-link-foundations.md` for the trust obligations and what the tests do not prove.
 */

// ---------------------------------------------------------------------------------------------
// Public results. Results never echo caller input, provider subjects or another owner.
// ---------------------------------------------------------------------------------------------

export type IdentityLinkBeginResult =
  | { readonly status: "started"; readonly state: string; readonly expiresAtMs: number }
  | { readonly status: "denied" }
  | { readonly status: "unavailable" };

export type IdentityLinkCompleteResult =
  | { readonly status: "linked" }
  | { readonly status: "already-linked" }
  | { readonly status: "conflict" }
  | { readonly status: "denied" }
  | { readonly status: "unavailable" };

const DENIED = Object.freeze({ status: "denied" as const });
const UNAVAILABLE = Object.freeze({ status: "unavailable" as const });
const LINKED = Object.freeze({ status: "linked" as const });
const ALREADY_LINKED = Object.freeze({ status: "already-linked" as const });
const CONFLICT = Object.freeze({ status: "conflict" as const });

// ---------------------------------------------------------------------------------------------
// Bounded shapes. Exact strings: no case folding, trimming or URL normalization anywhere.
// ---------------------------------------------------------------------------------------------

/** 256 random bits as unpadded base64url (43 chars); the final char carries 2 zero pad bits. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;
const STATE_BYTES = 32;
const NAMESPACE_KEY = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u);
const EXACT_TOKEN = z.string().regex(/^[\x21-\x7e]{1,256}$/u);
const OPAQUE_ID = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const SESSION_BINDING = z.string().regex(/^[A-Za-z0-9_-]{16,256}$/u);
const RECEIPT = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u);
const STATE_DIGEST = z.string().regex(/^[0-9a-f]{64}$/u);
const CODE = z.string().regex(/^[\x21-\x7e]{1,512}$/u);
const TIMESTAMP = z.number().refine((value) => Number.isSafeInteger(value) && value >= 0);
const MAX_FLOW_TTL_MS = 30 * 60 * 1_000;

const namespaceSchema = z
  .object({
    key: NAMESPACE_KEY,
    provider: EXACT_TOKEN,
    issuer: EXACT_TOKEN,
    environment: EXACT_TOKEN,
  })
  .strict();
const namespaceTupleSchema = z
  .object({ provider: EXACT_TOKEN, issuer: EXACT_TOKEN, environment: EXACT_TOKEN })
  .strict();

const configSchema = z
  .object({
    namespaces: z.array(namespaceSchema).min(1).max(16),
    flowTtlMs: z.number().int().min(1).max(MAX_FLOW_TTL_MS),
  })
  .strict();

/** The caller supplies only a configured namespace key and an opaque authentication context. */
const beginInputSchema = z.object({ namespace: NAMESPACE_KEY, authContext: z.unknown() }).strict();
const completeInputSchema = z
  .object({
    namespace: NAMESPACE_KEY,
    authContext: z.unknown(),
    state: z.string().regex(STATE_PATTERN),
    code: CODE,
  })
  .strict();

const sessionSchema = z
  .object({ principalId: OPAQUE_ID, sessionBinding: SESSION_BINDING, validUntilMs: TIMESTAMP })
  .strict()
  .refine((session) => session.sessionBinding !== session.principalId)
  .nullable();

const flowSchema = z
  .object({
    namespaceKey: NAMESPACE_KEY,
    namespace: namespaceTupleSchema,
    principalId: OPAQUE_ID,
    sessionBinding: SESSION_BINDING,
    stateDigest: STATE_DIGEST,
    issuedAtMs: TIMESTAMP,
    expiresAtMs: TIMESTAMP,
  })
  .strict();

const insertResultSchema = z.object({ status: z.enum(["inserted", "collision"]) }).strict();
const consumeResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("consumed"), flow: flowSchema, receipt: RECEIPT }).strict(),
  z.object({ status: z.literal("rejected") }).strict(),
]);
const verifyResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("verified"),
      provider: EXACT_TOKEN,
      issuer: EXACT_TOKEN,
      environment: EXACT_TOKEN,
      subject: EXACT_TOKEN,
    })
    .strict(),
  z.object({ status: z.literal("rejected") }).strict(),
]);
const finalizeResultSchema = z
  .object({
    status: z.enum(["linked", "already-linked", "conflict", "other-subject-linked", "rejected"]),
  })
  .strict();

// ---------------------------------------------------------------------------------------------
// Injected contracts.
// ---------------------------------------------------------------------------------------------

/**
 * The external namespace an identifier lives in. This exact tuple, not any local key, is the
 * identity and ownership scope: a subject is owned per `(provider, issuer, environment, subject)`.
 */
export interface IdentityNamespaceTuple {
  readonly provider: string;
  readonly issuer: string;
  readonly environment: string;
}

export interface IdentityNamespace extends IdentityNamespaceTuple {
  /**
   * Local configuration key the caller names. It routes a request to a configured tuple and is an
   * additional flow binding only. It is never external identity or an ownership scope: two
   * factories may use different keys for one tuple, or one key for different tuples.
   */
  readonly key: string;
}

export interface IdentityLinkConfig {
  readonly namespaces: readonly IdentityNamespace[];
  /** Upper bound on a pending flow's life; the session deadline can only shorten it. */
  readonly flowTtlMs: number;
}

/**
 * Server-derived session facts. `sessionBinding` must identify the session instance, must not be
 * the cookie value, the principal id or anything the caller can choose. Return null when there is
 * no valid session for an existing principal.
 */
export interface ResolvedSession {
  readonly principalId: string;
  readonly sessionBinding: string;
  readonly validUntilMs: number;
}

export interface PendingIdentityLinkFlow {
  readonly namespaceKey: string;
  /** The configured tuple bound at `begin`; immutable for the life of the flow and its receipt. */
  readonly namespace: IdentityNamespaceTuple;
  readonly principalId: string;
  readonly sessionBinding: string;
  /** Digest of the state. The raw state, code and any provider token are never stored. */
  readonly stateDigest: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

export interface ConsumeExpectation {
  readonly namespaceKey: string;
  readonly namespace: IdentityNamespaceTuple;
  readonly principalId: string;
  readonly sessionBinding: string;
  readonly stateDigest: string;
  readonly sessionValidUntilMs: number;
}

export interface FinalizeLinkRequest {
  readonly receipt: string;
  readonly principalId: string;
  readonly sessionBinding: string;
  readonly assertion: {
    readonly namespaceKey: string;
    /** Must equal the tuple the receipt's flow was bound to; ownership is scoped by it. */
    readonly namespace: IdentityNamespaceTuple;
    readonly subject: string;
  };
  /** Earliest of the flow and both session deadlines. The store compares it to its own clock. */
  readonly deadlineMs: number;
}

export type FinalizeLinkStatus =
  "linked" | "already-linked" | "conflict" | "other-subject-linked" | "rejected";

/**
 * Atomic persistence contract. Each method is one atomic decision evaluated against the store's
 * own current time at the decision point. The module trusts the store to keep these promises; a
 * future persistent adapter must enforce them itself (unique constraints, single-use receipts,
 * session fences) rather than rely on this module's pre-checks.
 */
export interface IdentityLinkStore {
  /** Insert only if no flow with this state digest exists. Never overwrite on collision. */
  insertFresh(flow: PendingIdentityLinkFlow): Promise<{ status: "inserted" | "collision" }>;
  /**
   * Consume the flow exactly once, only if namespace key, namespace tuple, principal, session
   * binding and digest all match exactly and neither the flow nor the session has expired at the
   * store's current time. A mismatch leaves the flow untouched. A consumed flow is never restored.
   * The receipt keeps an immutable copy of the flow's original tuple. The receipt is an internal
   * handle, never a public credential.
   */
  consumeIfMatches(
    expected: ConsumeExpectation,
  ): Promise<
    { status: "consumed"; flow: PendingIdentityLinkFlow; receipt: string } | { status: "rejected" }
  >;
  /**
   * Compare-and-link in one atomic step: the receipt is valid, unfinalized and bound to this
   * principal, session, namespace key and the exact tuple in the assertion; the principal still
   * exists; the store's current time is before `deadlineMs` and the flow expiry; and
   * `(provider, issuer, environment, subject)` is owned by nobody else, whichever key it was
   * linked through. Never creates, merges, reassigns, replaces or unlinks accounts or links, and
   * writes no profile.
   */
  finalize(request: FinalizeLinkRequest): Promise<{ status: FinalizeLinkStatus }>;
}

export interface IdentityControlVerifierInput {
  readonly namespace: IdentityNamespaceTuple;
  readonly code: string;
}

/** Establishes provider-side identifier control. Returns only namespace and subject, no tokens. */
export type IdentityControlVerifier = (
  input: IdentityControlVerifierInput,
) => Promise<
  | { status: "verified"; provider: string; issuer: string; environment: string; subject: string }
  | { status: "rejected" }
>;

export interface IdentityLinkDependencies {
  /** Derives the session from the opaque context only; never from caller-named principals. */
  readonly resolveSession: (authContext: unknown) => Promise<ResolvedSession | null>;
  readonly nowMs: () => number;
  /** Cryptographically secure random bytes. */
  readonly randomBytes: (length: number) => Uint8Array | Promise<Uint8Array>;
  /** Lowercase-hex 256-bit digest of the canonical state string. */
  readonly digestState: (state: string) => string | Promise<string>;
  readonly verify: IdentityControlVerifier;
  readonly store: IdentityLinkStore;
}

export interface IdentityLinkFlow {
  begin(input: unknown): Promise<IdentityLinkBeginResult>;
  complete(input: unknown): Promise<IdentityLinkCompleteResult>;
}

// ---------------------------------------------------------------------------------------------
// Implementation.
// ---------------------------------------------------------------------------------------------

/** Internal marker for a collaborator that broke its contract; always surfaces as unavailable. */
class DependencyContractError extends Error {}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Canonical unpadded base64url. */
function encodeBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const value =
      (bytes[index]! << 16) |
      ((remaining > 1 ? bytes[index + 1]! : 0) << 8) |
      (remaining > 2 ? bytes[index + 2]! : 0);
    out += BASE64URL[(value >> 18) & 63]! + BASE64URL[(value >> 12) & 63]!;
    if (remaining > 1) out += BASE64URL[(value >> 6) & 63]!;
    if (remaining > 2) out += BASE64URL[value & 63]!;
  }
  return out;
}

function parseOrThrow<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DependencyContractError();
  return parsed.data;
}

function parseInput<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T | null {
  try {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function sameTuple(bound: IdentityNamespaceTuple, claimed: IdentityNamespaceTuple): boolean {
  return (
    claimed.provider === bound.provider &&
    claimed.issuer === bound.issuer &&
    claimed.environment === bound.environment
  );
}

interface ConfiguredNamespace {
  readonly key: string;
  /** Frozen separately so the same immutable object is bound, verified and finalized. */
  readonly tuple: IdentityNamespaceTuple;
}

function snapshotConfig(
  config: unknown,
): { namespaces: ReadonlyMap<string, ConfiguredNamespace>; flowTtlMs: number } | null {
  const parsed = parseInput(configSchema, config);
  if (!parsed) return null;
  const byKey = new Map<string, ConfiguredNamespace>();
  const tuples = new Set<string>();
  for (const entry of parsed.namespaces) {
    const tupleKey = JSON.stringify([entry.provider, entry.issuer, entry.environment]);
    if (byKey.has(entry.key) || tuples.has(tupleKey)) return null;
    tuples.add(tupleKey);
    const tuple = Object.freeze({
      provider: entry.provider,
      issuer: entry.issuer,
      environment: entry.environment,
    });
    byKey.set(entry.key, Object.freeze({ key: entry.key, tuple }));
  }
  return { namespaces: byKey, flowTtlMs: parsed.flowTtlMs };
}

function snapshotDependencies(deps: unknown): IdentityLinkDependencies | null {
  try {
    if (typeof deps !== "object" || deps === null) return null;
    const source = deps as Record<string, unknown>;
    const store = source.store as Record<string, unknown> | null | undefined;
    if (typeof store !== "object" || store === null) return null;
    const functions = [
      source.resolveSession,
      source.nowMs,
      source.randomBytes,
      source.digestState,
      source.verify,
      store.insertFresh,
      store.consumeIfMatches,
      store.finalize,
    ];
    if (!functions.every((candidate) => typeof candidate === "function")) return null;
    const call = (fn: unknown, self: unknown) => (fn as (...args: unknown[]) => unknown).bind(self);
    return Object.freeze({
      resolveSession: call(source.resolveSession, deps),
      nowMs: call(source.nowMs, deps),
      randomBytes: call(source.randomBytes, deps),
      digestState: call(source.digestState, deps),
      verify: call(source.verify, deps),
      store: Object.freeze({
        insertFresh: call(store.insertFresh, store),
        consumeIfMatches: call(store.consumeIfMatches, store),
        finalize: call(store.finalize, store),
      }),
    }) as IdentityLinkDependencies;
  } catch {
    return null;
  }
}

/**
 * Build the orchestrator. Configuration and dependency references are validated and snapshotted
 * once; an invalid configuration or dependency set yields an orchestrator that is always
 * `unavailable` rather than throwing during module wiring.
 */
export function createIdentityLinkFlow(config: unknown, deps: unknown): IdentityLinkFlow {
  const snapshot = snapshotConfig(config);
  const d = snapshotDependencies(deps);
  if (!snapshot || !d) {
    return Object.freeze({
      begin: async () => UNAVAILABLE,
      complete: async () => UNAVAILABLE,
    });
  }
  const { namespaces, flowTtlMs } = snapshot;

  const now = (): number => parseOrThrow(TIMESTAMP, d.nowMs());
  const resolveSession = async (authContext: unknown): Promise<ResolvedSession | null> => {
    const session = parseOrThrow(sessionSchema, await d.resolveSession(authContext));
    return session ? Object.freeze({ ...session }) : null;
  };
  const digest = async (state: string): Promise<string> =>
    parseOrThrow(STATE_DIGEST, await d.digestState(state));

  async function begin(input: unknown): Promise<IdentityLinkBeginResult> {
    const request = parseInput(beginInputSchema, input);
    if (!request) return DENIED;
    const namespace = namespaces.get(request.namespace);
    if (!namespace) return DENIED;
    try {
      const session = await resolveSession(request.authContext);
      if (!session) return DENIED;
      const issuedAtMs = now();
      if (issuedAtMs >= session.validUntilMs) return DENIED;

      const bytes = await d!.randomBytes(STATE_BYTES);
      if (!(bytes instanceof Uint8Array) || bytes.length !== STATE_BYTES) {
        throw new DependencyContractError();
      }
      const state = encodeBase64Url(Uint8Array.from(bytes));
      const flow: PendingIdentityLinkFlow = Object.freeze({
        namespaceKey: namespace.key,
        namespace: namespace.tuple,
        principalId: session.principalId,
        sessionBinding: session.sessionBinding,
        stateDigest: await digest(state),
        issuedAtMs,
        expiresAtMs: Math.min(issuedAtMs + flowTtlMs, session.validUntilMs),
      });
      const inserted = parseOrThrow(insertResultSchema, await d!.store.insertFresh(flow));
      if (inserted.status !== "inserted") return UNAVAILABLE;
      if (now() >= flow.expiresAtMs) return UNAVAILABLE;
      return Object.freeze({ status: "started" as const, state, expiresAtMs: flow.expiresAtMs });
    } catch {
      return UNAVAILABLE;
    }
  }

  async function complete(input: unknown): Promise<IdentityLinkCompleteResult> {
    const request = parseInput(completeInputSchema, input);
    if (!request) return DENIED;
    const namespace = namespaces.get(request.namespace);
    if (!namespace) return DENIED;
    const { authContext, state, code } = request;
    try {
      const session = await resolveSession(authContext);
      if (!session) return DENIED;
      if (now() >= session.validUntilMs) return DENIED;

      const expected: ConsumeExpectation = Object.freeze({
        namespaceKey: namespace.key,
        namespace: namespace.tuple,
        principalId: session.principalId,
        sessionBinding: session.sessionBinding,
        stateDigest: await digest(state),
        sessionValidUntilMs: session.validUntilMs,
      });
      const consumed = parseOrThrow(consumeResultSchema, await d!.store.consumeIfMatches(expected));
      if (consumed.status === "rejected") return DENIED;
      const flow = consumed.flow;
      if (
        flow.namespaceKey !== expected.namespaceKey ||
        !sameTuple(expected.namespace, flow.namespace) ||
        flow.principalId !== expected.principalId ||
        flow.sessionBinding !== expected.sessionBinding ||
        flow.stateDigest !== expected.stateDigest ||
        flow.expiresAtMs <= flow.issuedAtMs ||
        flow.expiresAtMs - flow.issuedAtMs > flowTtlMs
      ) {
        throw new DependencyContractError();
      }
      const receipt = consumed.receipt;
      const consumedAtMs = now();
      if (consumedAtMs < flow.issuedAtMs) throw new DependencyContractError();
      if (consumedAtMs >= flow.expiresAtMs || consumedAtMs >= session.validUntilMs) return DENIED;

      // At most one verifier call per state: only the single successful consume reaches here. The
      // verifier, the result check and finalization all use the one frozen tuple bound at begin.
      const bound = namespace.tuple;
      const verification = parseOrThrow(
        verifyResultSchema,
        await d!.verify(Object.freeze({ namespace: bound, code })),
      );
      if (verification.status === "rejected") return DENIED;
      if (!sameTuple(bound, verification)) throw new DependencyContractError();
      const subject = verification.subject;

      if (now() >= Math.min(flow.expiresAtMs, session.validUntilMs)) return DENIED;
      const again = await resolveSession(authContext);
      if (
        !again ||
        again.principalId !== session.principalId ||
        again.sessionBinding !== session.sessionBinding
      ) {
        return DENIED;
      }
      const deadlineMs = Math.min(flow.expiresAtMs, session.validUntilMs, again.validUntilMs);
      if (now() >= deadlineMs) return DENIED;

      const finalized = parseOrThrow(
        finalizeResultSchema,
        await d!.store.finalize(
          Object.freeze({
            receipt,
            principalId: session.principalId,
            sessionBinding: session.sessionBinding,
            assertion: Object.freeze({ namespaceKey: namespace.key, namespace: bound, subject }),
            deadlineMs,
          }),
        ),
      );
      switch (finalized.status) {
        case "linked":
          return LINKED;
        case "already-linked":
          return ALREADY_LINKED;
        // Per-user cardinality is an owner decision; until then another subject fails closed.
        case "conflict":
        case "other-subject-linked":
          return CONFLICT;
        case "rejected":
          return DENIED;
      }
    } catch {
      // Includes an ambiguous finalize acknowledgement: a link may or may not have been
      // committed, so callers must reconcile and never report "not linked" from this result.
      return UNAVAILABLE;
    }
  }

  return Object.freeze({ begin, complete });
}
