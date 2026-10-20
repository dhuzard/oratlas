import { describe, expect, it } from "vitest";
import { sha256 } from "./hash";
import {
  createIdentityLinkFlow,
  type ConsumeExpectation,
  type FinalizeLinkRequest,
  type FinalizeLinkStatus,
  type IdentityControlVerifierInput,
  type IdentityLinkConfig,
  type IdentityLinkDependencies,
  type IdentityLinkStore,
  type IdentityNamespaceTuple,
  type PendingIdentityLinkFlow,
  type ResolvedSession,
} from "./identity-link-foundations";

// Synthetic fixtures only: no real provider, issuer, person or identifier. The fake store proves
// the orchestrator and its store contract, not database concurrency, PKCE or OAuth security.

const T0 = 1_000_000;
const TTL = 60_000;
const NAMESPACE = {
  key: "synthetic-a",
  provider: "synthetic-provider",
  issuer: "https://issuer.invalid/a",
  environment: "fixture",
};
const TUPLE: IdentityNamespaceTuple = {
  provider: NAMESPACE.provider,
  issuer: NAMESPACE.issuer,
  environment: NAMESPACE.environment,
};
const CONFIG: IdentityLinkConfig = { namespaces: [NAMESPACE], flowTtlMs: TTL };
const VERIFIED = { status: "verified" as const, ...TUPLE };

/** Collision-safe ownership key: the external tuple plus subject, never a local namespace key. */
function ownerKey(namespace: IdentityNamespaceTuple, subject: string): string {
  return JSON.stringify([namespace.provider, namespace.issuer, namespace.environment, subject]);
}

function tupleKey(namespace: IdentityNamespaceTuple): string {
  return JSON.stringify([namespace.provider, namespace.issuer, namespace.environment]);
}

function frozenTuple(namespace: IdentityNamespaceTuple): IdentityNamespaceTuple {
  return Object.freeze({
    provider: namespace.provider,
    issuer: namespace.issuer,
    environment: namespace.environment,
  });
}

/** Stored copies are frozen, nested tuple included, so callers cannot retarget them later. */
function snapshotFlow(flow: PendingIdentityLinkFlow): PendingIdentityLinkFlow {
  return Object.freeze({ ...flow, namespace: frozenTuple(flow.namespace) });
}

/** Returned copies are fresh and mutable, isolated from the store's own state. */
function copyFlow(flow: PendingIdentityLinkFlow): PendingIdentityLinkFlow {
  return { ...flow, namespace: { ...flow.namespace } };
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

/** Let every already-queued continuation run (no timers involved). */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

interface LinkRecord {
  principalId: string;
  namespaceKey: string;
  linkedAtMs: number;
  receipt: string;
}

/**
 * In-memory store honouring the atomic contract. Each decision runs synchronously after its
 * optional barrier, reading the shared clock inside that critical section. Flows and receipts
 * are bound to key and tuple; ownership and cardinality are scoped by tuple only.
 */
function createFakeStore(clock: { now: number }) {
  const flows = new Map<string, PendingIdentityLinkFlow>();
  const receipts = new Map<string, { flow: PendingIdentityLinkFlow; finalized: boolean }>();
  const links = new Map<string, LinkRecord>();
  /** Explicit per-tuple cardinality: principals already holding a subject in each tuple. */
  const tupleHolders = new Map<string, Set<string>>();
  const principals = new Set<string>(["principal-alice", "principal-bob"]);
  let receiptCounter = 0;
  const hooks: {
    beforeConsume?: () => Promise<void>;
    beforeFinalize?: () => Promise<void>;
    finalizeFault?: "before-commit" | "after-commit";
  } = {};
  const store: IdentityLinkStore = {
    async insertFresh(flow) {
      if (flows.has(flow.stateDigest)) return { status: "collision" };
      flows.set(flow.stateDigest, snapshotFlow(flow));
      return { status: "inserted" };
    },
    async consumeIfMatches(expected: ConsumeExpectation) {
      await hooks.beforeConsume?.();
      const flow = flows.get(expected.stateDigest);
      if (
        !flow ||
        flow.namespaceKey !== expected.namespaceKey ||
        tupleKey(flow.namespace) !== tupleKey(expected.namespace) ||
        flow.principalId !== expected.principalId ||
        flow.sessionBinding !== expected.sessionBinding
      ) {
        return { status: "rejected" }; // checked before deletion: the flow stays usable
      }
      flows.delete(expected.stateDigest); // consumed or expired: never restored
      if (clock.now >= flow.expiresAtMs || clock.now >= expected.sessionValidUntilMs) {
        return { status: "rejected" };
      }
      receiptCounter += 1;
      const receipt = `receipt-${String(receiptCounter).padStart(10, "0")}`;
      receipts.set(receipt, { flow, finalized: false });
      return { status: "consumed", flow: copyFlow(flow), receipt };
    },
    async finalize(request: FinalizeLinkRequest) {
      await hooks.beforeFinalize?.();
      if (hooks.finalizeFault === "before-commit") throw new Error("synthetic rollback");
      const entry = receipts.get(request.receipt);
      const decide = (): FinalizeLinkStatus => {
        if (!entry || entry.finalized) return "rejected";
        const { flow } = entry;
        if (
          flow.principalId !== request.principalId ||
          flow.sessionBinding !== request.sessionBinding ||
          flow.namespaceKey !== request.assertion.namespaceKey ||
          tupleKey(flow.namespace) !== tupleKey(request.assertion.namespace)
        ) {
          return "rejected";
        }
        entry.finalized = true;
        if (clock.now >= request.deadlineMs || clock.now >= flow.expiresAtMs) return "rejected";
        if (!principals.has(request.principalId)) return "rejected";
        // Ownership and cardinality use the receipt's original tuple, never the alias key.
        const key = ownerKey(flow.namespace, request.assertion.subject);
        const owner = links.get(key);
        if (owner) return owner.principalId === request.principalId ? "already-linked" : "conflict";
        const scope = tupleKey(flow.namespace);
        const held = tupleHolders.get(scope);
        if (held?.has(request.principalId)) return "other-subject-linked";
        links.set(key, {
          principalId: request.principalId,
          namespaceKey: flow.namespaceKey,
          linkedAtMs: clock.now,
          receipt: request.receipt,
        });
        tupleHolders.set(scope, new Set([...(held ?? []), request.principalId]));
        return "linked";
      };
      const status = decide();
      if (hooks.finalizeFault === "after-commit") throw new Error("synthetic lost acknowledgement");
      return { status };
    },
  };
  return { store, flows, receipts, links, principals, hooks };
}

type MutableSession = { -readonly [K in keyof ResolvedSession]: ResolvedSession[K] };
type VerifierImpl = (input: IdentityControlVerifierInput) => Promise<unknown>;

function harness(
  options: {
    config?: unknown;
    deps?: (base: IdentityLinkDependencies, clock: { now: number }) => unknown;
  } = {},
) {
  const clock = { now: T0 };
  const sessions = new Map<string, MutableSession>([
    [
      "ctx-alice",
      {
        principalId: "principal-alice",
        sessionBinding: "binding-alice-0001",
        validUntilMs: T0 + 10 * TTL,
      },
    ],
    [
      "ctx-bob",
      {
        principalId: "principal-bob",
        sessionBinding: "binding-bob-000001",
        validUntilMs: T0 + 10 * TTL,
      },
    ],
  ]);
  const fake = createFakeStore(clock);
  let randomCounter = 0;
  const randomBytes: { impl: (length: number) => unknown } = {
    impl: (length) => {
      randomCounter += 1;
      return Uint8Array.from({ length }, (_, i) => (randomCounter * 37 + i * 11) & 0xff);
    },
  };
  const subjects = new Map<string, string>([
    ["code-alice", "synthetic-subject-1"],
    ["code-bob", "synthetic-subject-1"],
    ["code-other", "synthetic-subject-2"],
  ]);
  const verifierCalls: IdentityControlVerifierInput[] = [];
  const verifier: { impl: VerifierImpl } = {
    // Echoes the requested tuple, so separate factories over one store can be exercised.
    impl: async (input) => {
      const subject = subjects.get(input.code);
      return subject ? { status: "verified", ...input.namespace, subject } : { status: "rejected" };
    },
  };
  const sessionCalls: unknown[] = [];
  const base: IdentityLinkDependencies = {
    resolveSession: async (context) => {
      sessionCalls.push(context);
      const session = typeof context === "string" ? sessions.get(context) : undefined;
      return session ? { ...session } : null;
    },
    nowMs: () => clock.now,
    randomBytes: (length) => randomBytes.impl(length) as Uint8Array,
    digestState: (state) => sha256(state),
    verify: async (input) => {
      verifierCalls.push(input);
      return (await verifier.impl(input)) as Awaited<
        ReturnType<IdentityLinkDependencies["verify"]>
      >;
    },
    store: fake.store,
  };
  const deps = options.deps ? options.deps(base, clock) : base;
  const flow = createIdentityLinkFlow("config" in options ? options.config : CONFIG, deps);
  return {
    flow,
    /** Another orchestrator instance over the same store, clock, sessions and verifier. */
    factory: (config: unknown) => createIdentityLinkFlow(config, deps),
    clock,
    sessions,
    fake,
    randomBytes,
    verifier,
    verifierCalls,
    sessionCalls,
    subjects,
  };
}

type Harness = ReturnType<typeof harness>;

async function started(h: Harness, authContext = "ctx-alice"): Promise<string> {
  const result = await h.flow.begin({ namespace: NAMESPACE.key, authContext });
  if (result.status !== "started") throw new Error(`begin failed: ${result.status}`);
  return result.state;
}

function callback(state: string, code = "code-alice", authContext: unknown = "ctx-alice") {
  return { namespace: NAMESPACE.key, authContext, state, code };
}

describe("identity link begin", () => {
  it("binds a fresh 256-bit canonical state to the resolved principal, session and namespace", async () => {
    const h = harness();
    const result = await h.flow.begin({ namespace: NAMESPACE.key, authContext: "ctx-alice" });
    const expectedBytes = Uint8Array.from({ length: 32 }, (_, i) => (37 + i * 11) & 0xff);
    expect(result).toEqual({
      status: "started",
      state: Buffer.from(expectedBytes).toString("base64url"),
      expiresAtMs: T0 + TTL,
    });
    expect(Object.isFrozen(result)).toBe(true);
    const stored = [...h.fake.flows.values()];
    expect(stored).toEqual([
      {
        namespaceKey: NAMESPACE.key,
        namespace: TUPLE,
        principalId: "principal-alice",
        sessionBinding: "binding-alice-0001",
        stateDigest: sha256((result as { state: string }).state),
        issuedAtMs: T0,
        expiresAtMs: T0 + TTL,
      },
    ]);
  });

  it("never outlives the session deadline", async () => {
    const h = harness();
    h.sessions.get("ctx-alice")!.validUntilMs = T0 + 5;
    const result = await h.flow.begin({ namespace: NAMESPACE.key, authContext: "ctx-alice" });
    expect(result).toMatchObject({ status: "started", expiresAtMs: T0 + 5 });
  });

  it.each([
    ["non-object", "nope"],
    ["unknown namespace", { namespace: "synthetic-b", authContext: "ctx-alice" }],
    ["namespace not exact", { namespace: "Synthetic-A", authContext: "ctx-alice" }],
    [
      "caller-named principal",
      { namespace: NAMESPACE.key, authContext: "ctx-alice", principalId: "principal-bob" },
    ],
    [
      "caller session binding",
      { namespace: NAMESPACE.key, authContext: "ctx-alice", sessionBinding: "binding-bob-000001" },
    ],
  ])("denies malformed input: %s", async (_label, input) => {
    const h = harness();
    expect(await h.flow.begin(input)).toEqual({ status: "denied" });
    expect(h.fake.flows.size).toBe(0);
  });

  it("denies a missing or expired session", async () => {
    const h = harness();
    expect(await h.flow.begin({ namespace: NAMESPACE.key, authContext: "ctx-nobody" })).toEqual({
      status: "denied",
    });
    h.clock.now = T0 + 10 * TTL; // exactly the session deadline
    expect(await h.flow.begin({ namespace: NAMESPACE.key, authContext: "ctx-alice" })).toEqual({
      status: "denied",
    });
    expect(h.fake.flows.size).toBe(0);
  });

  it.each([
    ["missing", undefined],
    ["empty allowlist", { namespaces: [], flowTtlMs: TTL }],
    ["duplicate key", { namespaces: [NAMESPACE, { ...NAMESPACE, issuer: "x" }], flowTtlMs: TTL }],
    [
      "duplicate tuple",
      { namespaces: [NAMESPACE, { ...NAMESPACE, key: "synthetic-b" }], flowTtlMs: TTL },
    ],
    ["unbounded ttl", { namespaces: [NAMESPACE], flowTtlMs: 31 * 60 * 1_000 }],
    ["extra field", { namespaces: [NAMESPACE], flowTtlMs: TTL, allowAny: true }],
  ])("is unavailable with invalid config: %s", async (_label, config) => {
    const h = harness({ config });
    expect(await h.flow.begin({ namespace: NAMESPACE.key, authContext: "ctx-alice" })).toEqual({
      status: "unavailable",
    });
    expect(await h.flow.complete(callback("A".repeat(43)))).toEqual({ status: "unavailable" });
  });

  it("snapshots config: later mutation has no effect", async () => {
    const config = { namespaces: [{ ...NAMESPACE }], flowTtlMs: TTL };
    const h = harness({ config });
    config.namespaces[0]!.key = "synthetic-z";
    config.flowTtlMs = 1;
    expect(
      await h.flow.begin({ namespace: NAMESPACE.key, authContext: "ctx-alice" }),
    ).toMatchObject({ status: "started", expiresAtMs: T0 + TTL });
  });

  it("is unavailable when dependencies are missing", async () => {
    const h = harness({ deps: (base) => ({ ...base, verify: undefined }) });
    expect(await h.flow.begin({ namespace: NAMESPACE.key, authContext: "ctx-alice" })).toEqual({
      status: "unavailable",
    });
  });

  it.each([
    [
      "throws",
      () => {
        throw new Error("rng");
      },
    ],
    ["short", () => new Uint8Array(31)],
    ["long", () => new Uint8Array(33)],
    ["not bytes", () => Array.from({ length: 32 }, () => 1)],
  ])("is unavailable when the random source %s", async (_label, impl) => {
    const h = harness();
    h.randomBytes.impl = impl;
    expect(await h.flow.begin({ namespace: NAMESPACE.key, authContext: "ctx-alice" })).toEqual({
      status: "unavailable",
    });
    expect(h.fake.flows.size).toBe(0);
  });

  it("fails closed on a state-digest collision without overwriting the existing flow", async () => {
    const h = harness();
    h.randomBytes.impl = (length) => new Uint8Array(length).fill(7);
    await started(h);
    const before = [...h.fake.flows.values()];
    expect(await h.flow.begin({ namespace: NAMESPACE.key, authContext: "ctx-bob" })).toEqual({
      status: "unavailable",
    });
    expect([...h.fake.flows.values()]).toEqual(before);
  });

  it.each([
    [
      "session resolver throws",
      (b: IdentityLinkDependencies) => ({
        ...b,
        resolveSession: async () => {
          throw new Error("x");
        },
      }),
    ],
    [
      "session has extra field",
      (b: IdentityLinkDependencies) => ({
        ...b,
        resolveSession: async () => ({
          principalId: "principal-alice",
          sessionBinding: "binding-alice-0001",
          validUntilMs: T0 + TTL,
          role: "ADMIN",
        }),
      }),
    ],
    [
      "binding equals principal",
      (b: IdentityLinkDependencies) => ({
        ...b,
        resolveSession: async () => ({
          principalId: "principal-alice-x",
          sessionBinding: "principal-alice-x",
          validUntilMs: T0 + TTL,
        }),
      }),
    ],
    ["clock is not a safe integer", (b: IdentityLinkDependencies) => ({ ...b, nowMs: () => 1.5 })],
    [
      "hash throws",
      (b: IdentityLinkDependencies) => ({
        ...b,
        digestState: () => {
          throw new Error("x");
        },
      }),
    ],
    ["hash is malformed", (b: IdentityLinkDependencies) => ({ ...b, digestState: () => "ABC" })],
    [
      "insert throws",
      (b: IdentityLinkDependencies) => ({
        ...b,
        store: {
          ...b.store,
          insertFresh: async () => {
            throw new Error("x");
          },
        },
      }),
    ],
    [
      "insert result malformed",
      (b: IdentityLinkDependencies) => ({
        ...b,
        store: { ...b.store, insertFresh: async () => ({ status: "ok" }) },
      }),
    ],
  ])("is unavailable when %s", async (_label, deps) => {
    const h = harness({ deps });
    expect(await h.flow.begin({ namespace: NAMESPACE.key, authContext: "ctx-alice" })).toEqual({
      status: "unavailable",
    });
  });
});

describe("identity link complete", () => {
  it("links the subject to the current principal and stores no raw state or code", async () => {
    const h = harness();
    const state = await started(h);
    const result = await h.flow.complete(callback(state));
    expect(result).toEqual({ status: "linked" });
    expect(Object.keys(result)).toEqual(["status"]);
    expect(h.verifierCalls).toEqual([
      {
        namespace: {
          provider: NAMESPACE.provider,
          issuer: NAMESPACE.issuer,
          environment: NAMESPACE.environment,
        },
        code: "code-alice",
      },
    ]);
    expect([...h.fake.links]).toEqual([
      [
        ownerKey(TUPLE, "synthetic-subject-1"),
        {
          principalId: "principal-alice",
          namespaceKey: NAMESPACE.key,
          linkedAtMs: T0,
          receipt: "receipt-0000000001",
        },
      ],
    ]);
    const persisted = JSON.stringify({
      flows: [...h.fake.flows],
      receipts: [...h.fake.receipts],
      links: [...h.fake.links],
    });
    expect(persisted).not.toContain(state);
    expect(persisted).not.toContain("code-alice");
    expect(h.sessionCalls).toEqual(["ctx-alice", "ctx-alice", "ctx-alice"]);
  });

  it.each([
    [
      "caller-asserted principal",
      (s: string) => ({ ...callback(s), principalId: "principal-alice" }),
    ],
    [
      "caller-asserted subject",
      (s: string) => ({ ...callback(s), subject: "synthetic-subject-1" }),
    ],
    ["non-canonical state", (s: string) => callback(`${s.slice(0, 42)}B`)],
    ["short state", (s: string) => callback(s.slice(1))],
    ["padded state", (s: string) => callback(`${s}=`)],
    ["empty code", (s: string) => callback(s, "")],
    ["oversized code", (s: string) => callback(s, "c".repeat(513))],
    ["code with whitespace", (s: string) => callback(s, "code alice")],
    ["unknown namespace", (s: string) => ({ ...callback(s), namespace: "synthetic-b" })],
  ])("denies malformed callbacks before any dependency runs: %s", async (_label, build) => {
    const h = harness();
    const state = await started(h);
    h.sessionCalls.length = 0;
    expect(await h.flow.complete(build(state))).toEqual({ status: "denied" });
    expect(h.sessionCalls).toEqual([]);
    expect(h.verifierCalls).toEqual([]);
    expect(h.fake.flows.size).toBe(1);
  });

  it.each([
    ["wrong principal", { authContext: "ctx-bob" }],
    ["wrong state", { state: "A".repeat(43) }],
    ["no session", { authContext: "ctx-nobody" }],
  ])("denies a %s before the verifier and leaves the flow intact", async (_label, override) => {
    const h = harness();
    const state = await started(h);
    expect(await h.flow.complete({ ...callback(state), ...override })).toEqual({
      status: "denied",
    });
    expect(h.verifierCalls).toEqual([]);
    expect(h.fake.flows.size).toBe(1);
  });

  it("denies the same principal on a different session binding", async () => {
    const h = harness();
    const state = await started(h);
    h.sessions.set("ctx-alice-2", {
      principalId: "principal-alice",
      sessionBinding: "binding-alice-0002",
      validUntilMs: T0 + 10 * TTL,
    });
    expect(await h.flow.complete(callback(state, "code-alice", "ctx-alice-2"))).toEqual({
      status: "denied",
    });
    expect(h.verifierCalls).toEqual([]);
  });

  it("denies a state issued for another namespace", async () => {
    const other = { ...NAMESPACE, key: "synthetic-b", environment: "fixture-b" };
    const h = harness({ config: { namespaces: [NAMESPACE, other], flowTtlMs: TTL } });
    const state = await started(h);
    expect(await h.flow.complete({ ...callback(state), namespace: "synthetic-b" })).toEqual({
      status: "denied",
    });
    expect(h.verifierCalls).toEqual([]);
  });

  it("denies a replayed state and never restores a consumed state", async () => {
    const h = harness();
    const state = await started(h);
    expect(await h.flow.complete(callback(state))).toEqual({ status: "linked" });
    expect(await h.flow.complete(callback(state))).toEqual({ status: "denied" });
    expect(h.verifierCalls).toHaveLength(1);
  });

  it("keeps the state consumed when the exchange fails", async () => {
    const h = harness();
    const state = await started(h);
    h.verifier.impl = async () => {
      throw new Error("synthetic provider outage");
    };
    expect(await h.flow.complete(callback(state))).toEqual({ status: "unavailable" });
    h.verifier.impl = async () => ({ ...VERIFIED, subject: "synthetic-subject-1" });
    expect(await h.flow.complete(callback(state))).toEqual({ status: "denied" });
    expect(h.verifierCalls).toHaveLength(1);
    expect(h.fake.links.size).toBe(0);
  });

  it("invokes the verifier once for simultaneous callbacks with the same state", async () => {
    const h = harness();
    const state = await started(h);
    const gate = deferred();
    h.verifier.impl = async () => {
      await gate.promise;
      return { ...VERIFIED, subject: "synthetic-subject-1" };
    };
    const first = h.flow.complete(callback(state));
    const second = h.flow.complete(callback(state));
    await settle();
    expect(h.verifierCalls).toHaveLength(1);
    gate.release();
    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.status).sort()).toEqual(["denied", "linked"]);
    expect(h.verifierCalls).toHaveLength(1);
  });

  describe("deadlines", () => {
    it("denies a flow that expired before the callback", async () => {
      const h = harness();
      const state = await started(h);
      h.clock.now = T0 + TTL + 1;
      expect(await h.flow.complete(callback(state))).toEqual({ status: "denied" });
      expect(h.verifierCalls).toEqual([]);
    });

    it("denies a callback at exactly the deadline", async () => {
      const h = harness();
      const state = await started(h);
      h.clock.now = T0 + TTL;
      expect(await h.flow.complete(callback(state))).toEqual({ status: "denied" });
      expect(h.verifierCalls).toEqual([]);
    });

    it("accepts one millisecond before the deadline", async () => {
      const h = harness();
      const state = await started(h);
      h.clock.now = T0 + TTL - 1;
      expect(await h.flow.complete(callback(state))).toEqual({ status: "linked" });
    });

    it("denies when the flow expires during the exchange", async () => {
      const h = harness();
      const state = await started(h);
      h.verifier.impl = async () => {
        h.clock.now = T0 + TTL;
        return { ...VERIFIED, subject: "synthetic-subject-1" };
      };
      expect(await h.flow.complete(callback(state))).toEqual({ status: "denied" });
      expect(h.fake.links.size).toBe(0);
    });

    it("denies when the session expires during the exchange", async () => {
      const h = harness();
      h.sessions.get("ctx-alice")!.validUntilMs = T0 + TTL * 2;
      const state = await started(h);
      h.verifier.impl = async () => {
        h.clock.now = T0 + TTL - 1;
        h.sessions.get("ctx-alice")!.validUntilMs = T0 + TTL - 1;
        return { ...VERIFIED, subject: "synthetic-subject-1" };
      };
      expect(await h.flow.complete(callback(state))).toEqual({ status: "denied" });
      expect(h.fake.links.size).toBe(0);
    });

    it.each([
      [
        "time reaches the deadline",
        (clock: { now: number }, session: ResolvedSession) => {
          clock.now = T0 + TTL;
          return session;
        },
      ],
      [
        "the session deadline shrinks",
        (clock: { now: number }, session: ResolvedSession) => {
          clock.now = T0 + 10;
          return { ...session, validUntilMs: T0 + 10 };
        },
      ],
    ])("denies when %s during the session recheck", async (_label, recheck) => {
      let calls = 0;
      const h = harness({
        deps: (base, clock) => ({
          ...base,
          resolveSession: async (context: unknown) => {
            calls += 1;
            const session = await base.resolveSession(context);
            return calls === 3 && session ? recheck(clock, session) : session;
          },
        }),
      });
      const state = await started(h);
      expect(await h.flow.complete(callback(state))).toEqual({ status: "denied" });
      expect(calls).toBe(3);
      expect(h.verifierCalls).toHaveLength(1);
      expect(h.fake.links.size).toBe(0);
      expect([...h.fake.receipts.values()].map((r) => r.finalized)).toEqual([false]);
    });

    it("denies a queued finalization that reaches the store after the deadline", async () => {
      const h = harness();
      const state = await started(h);
      const gate = deferred();
      let finalizeQueued = false;
      h.fake.hooks.beforeFinalize = async () => {
        finalizeQueued = true;
        await gate.promise;
      };
      const pending = h.flow.complete(callback(state));
      await settle();
      expect(finalizeQueued).toBe(true);
      h.clock.now = T0 + TTL;
      gate.release();
      expect(await pending).toEqual({ status: "denied" });
      expect(h.fake.links.size).toBe(0);
    });
  });

  describe("session changes during the exchange", () => {
    async function during(mutate: (h: Harness) => void) {
      const h = harness();
      const state = await started(h);
      h.verifier.impl = async () => {
        mutate(h);
        return { ...VERIFIED, subject: "synthetic-subject-1" };
      };
      const result = await h.flow.complete(callback(state));
      return { h, result };
    }

    it("denies after logout", async () => {
      const { h, result } = await during((h) => h.sessions.delete("ctx-alice"));
      expect(result).toEqual({ status: "denied" });
      expect(h.fake.links.size).toBe(0);
    });

    it("denies after the session binding changes", async () => {
      const { h, result } = await during((h) => {
        h.sessions.get("ctx-alice")!.sessionBinding = "binding-alice-0002";
      });
      expect(result).toEqual({ status: "denied" });
      expect(h.fake.links.size).toBe(0);
    });

    it("denies after the context resolves to another principal", async () => {
      const { h, result } = await during((h) =>
        h.sessions.set("ctx-alice", h.sessions.get("ctx-bob")!),
      );
      expect(result).toEqual({ status: "denied" });
      expect(h.fake.links.size).toBe(0);
    });

    it("denies after the principal is deleted", async () => {
      const { h, result } = await during((h) => h.fake.principals.delete("principal-alice"));
      expect(result).toEqual({ status: "denied" });
      expect(h.fake.links.size).toBe(0);
    });
  });

  describe("verifier results", () => {
    it.each([
      ["rejects the code", { status: "rejected" }, "denied"],
      [
        "returns another provider",
        { ...VERIFIED, provider: "synthetic-provider-2", subject: "s" },
        "unavailable",
      ],
      [
        "returns another issuer",
        { ...VERIFIED, issuer: `${NAMESPACE.issuer}/`, subject: "s" },
        "unavailable",
      ],
      [
        "returns another environment",
        { ...VERIFIED, environment: "FIXTURE", subject: "s" },
        "unavailable",
      ],
      [
        "returns a token",
        { ...VERIFIED, subject: "s", accessToken: "synthetic-token" },
        "unavailable",
      ],
      ["returns no subject", { ...VERIFIED }, "unavailable"],
      ["returns null", null, "unavailable"],
    ])("fails closed when the verifier %s", async (_label, value, expected) => {
      const h = harness();
      const state = await started(h);
      h.verifier.impl = async () => value;
      expect(await h.flow.complete(callback(state))).toEqual({ status: expected });
      expect(h.fake.links.size).toBe(0);
    });
  });

  describe("ownership", () => {
    it("links one of two users racing for the same subject and reports conflict to the other", async () => {
      const h = harness();
      const aliceState = await started(h, "ctx-alice");
      const bobState = await started(h, "ctx-bob");
      const gate = deferred();
      let queued = 0;
      h.fake.hooks.beforeFinalize = async () => {
        queued += 1;
        await gate.promise;
      };
      const alice = h.flow.complete(callback(aliceState, "code-alice", "ctx-alice"));
      const bob = h.flow.complete(callback(bobState, "code-bob", "ctx-bob"));
      await settle();
      expect(queued).toBe(2);
      gate.release();
      const results = await Promise.all([alice, bob]);
      expect(results.map((r) => r.status).sort()).toEqual(["conflict", "linked"]);
      for (const result of results) expect(Object.keys(result)).toEqual(["status"]);
      expect(h.fake.links.size).toBe(1);
      expect(JSON.stringify(results)).not.toMatch(/principal|subject|receipt/);
    });

    it("returns already-linked for an independent second flow by the same user and keeps the record", async () => {
      const h = harness();
      expect(await h.flow.complete(callback(await started(h)))).toEqual({ status: "linked" });
      const record = { ...h.fake.links.values().next().value! };
      h.clock.now = T0 + 5;
      expect(await h.flow.complete(callback(await started(h)))).toEqual({
        status: "already-linked",
      });
      expect([...h.fake.links.values()]).toEqual([record]);
    });

    it("refuses a second subject for the same user in a namespace pending the cardinality decision", async () => {
      const h = harness();
      expect(await h.flow.complete(callback(await started(h)))).toEqual({ status: "linked" });
      expect(await h.flow.complete(callback(await started(h), "code-other"))).toEqual({
        status: "conflict",
      });
      expect(h.fake.links.size).toBe(1);
    });
  });

  describe("dependency failures", () => {
    it.each([
      [
        "consume throws",
        (h: Harness) =>
          (h.fake.hooks.beforeConsume = async () => {
            throw new Error("x");
          }),
      ],
      ["finalize rolls back", (h: Harness) => (h.fake.hooks.finalizeFault = "before-commit")],
      [
        "session recheck throws",
        (h: Harness) => {
          h.verifier.impl = async () => {
            h.sessions.set("ctx-alice", { bad: true } as unknown as MutableSession);
            return { ...VERIFIED, subject: "synthetic-subject-1" };
          };
        },
      ],
    ])("is unavailable when %s", async (_label, arrange) => {
      const h = harness();
      const state = await started(h);
      arrange(h);
      expect(await h.flow.complete(callback(state))).toEqual({ status: "unavailable" });
      expect(h.fake.links.size).toBe(0);
    });

    it("is unavailable on a lost finalize acknowledgement; reconciliation shows the link exists", async () => {
      const h = harness();
      const state = await started(h);
      h.fake.hooks.finalizeFault = "after-commit";
      expect(await h.flow.complete(callback(state))).toEqual({ status: "unavailable" });
      expect(h.fake.links.size).toBe(1); // ambiguous result is not proof that no link exists
      h.fake.hooks.finalizeFault = undefined;
      expect(await h.flow.complete(callback(await started(h)))).toEqual({
        status: "already-linked",
      });
    });

    it.each([
      [
        "consume result has extra fields",
        (s: IdentityLinkStore) => ({
          ...s,
          consumeIfMatches: async (e: ConsumeExpectation) => ({
            ...(await s.consumeIfMatches(e)),
            token: "t",
          }),
        }),
      ],
      [
        "consumed flow is for another principal",
        (s: IdentityLinkStore) => ({
          ...s,
          consumeIfMatches: async (e: ConsumeExpectation) => {
            const r = await s.consumeIfMatches(e);
            return r.status === "consumed"
              ? { ...r, flow: { ...r.flow, principalId: "principal-bob" } }
              : r;
          },
        }),
      ],
      [
        "consumed flow exceeds the configured ttl",
        (s: IdentityLinkStore) => ({
          ...s,
          consumeIfMatches: async (e: ConsumeExpectation) => {
            const r = await s.consumeIfMatches(e);
            return r.status === "consumed"
              ? { ...r, flow: { ...r.flow, expiresAtMs: r.flow.issuedAtMs + TTL + 1 } }
              : r;
          },
        }),
      ],
      [
        "receipt is malformed",
        (s: IdentityLinkStore) => ({
          ...s,
          consumeIfMatches: async (e: ConsumeExpectation) => {
            const r = await s.consumeIfMatches(e);
            return r.status === "consumed" ? { ...r, receipt: "short" } : r;
          },
        }),
      ],
      [
        "finalize result is unknown",
        (s: IdentityLinkStore) => ({
          ...s,
          finalize: async () => ({ status: "replaced" }),
        }),
      ],
    ])("is unavailable when the %s", async (_label, wrap) => {
      const h = harness({ deps: (base) => ({ ...base, store: wrap(base.store) }) });
      const state = await started(h);
      expect(await h.flow.complete(callback(state))).toEqual({ status: "unavailable" });
    });
  });
});

describe("namespace tuple binding over a shared store", () => {
  const ALIAS_KEY = "synthetic-alias";
  const configOf = (...namespaces: unknown[]) => ({ namespaces, flowTtlMs: TTL });
  const aliasCallback = (state: string, code = "code-alice", authContext = "ctx-alice") => ({
    ...callback(state, code, authContext),
    namespace: ALIAS_KEY,
  });
  async function startedVia(
    flow: ReturnType<typeof createIdentityLinkFlow>,
    namespace: string,
    authContext = "ctx-alice",
  ): Promise<string> {
    const result = await flow.begin({ namespace, authContext });
    if (result.status !== "started") throw new Error(`begin failed: ${result.status}`);
    return result.state;
  }

  it.each([
    ["provider", { provider: "synthetic-provider-2" }],
    ["issuer", { issuer: "https://issuer.invalid/b" }],
    ["environment", { environment: "fixture-b" }],
  ])(
    "denies a flow completed through another factory whose same key has a different %s",
    async (_label, change) => {
      const h = harness();
      const other = h.factory(configOf({ ...NAMESPACE, ...change }));
      const state = await started(h);
      const before = [...h.fake.flows.values()];
      expect(await other.complete(callback(state))).toEqual({ status: "denied" });
      expect(h.verifierCalls).toEqual([]);
      expect(h.fake.receipts.size).toBe(0);
      expect(h.fake.links.size).toBe(0);
      expect([...h.fake.flows.values()]).toEqual(before);
      // The original flow is untouched and still completes through its own factory.
      expect(await h.flow.complete(callback(state))).toEqual({ status: "linked" });
      expect([...h.fake.links.keys()]).toEqual([ownerKey(TUPLE, "synthetic-subject-1")]);
    },
  );

  it("links one of two users racing through different keys for the same tuple and subject", async () => {
    const h = harness();
    const alias = h.factory(configOf({ ...NAMESPACE, key: ALIAS_KEY }));
    const aliceState = await started(h, "ctx-alice");
    const bobState = await startedVia(alias, ALIAS_KEY, "ctx-bob");
    const gate = deferred();
    let queued = 0;
    h.fake.hooks.beforeFinalize = async () => {
      queued += 1;
      await gate.promise;
    };
    const alice = h.flow.complete(callback(aliceState, "code-alice", "ctx-alice"));
    const bob = alias.complete(aliasCallback(bobState, "code-bob", "ctx-bob"));
    await settle();
    expect(queued).toBe(2);
    gate.release();
    const results = await Promise.all([alice, bob]);
    expect(results.map((r) => r.status).sort()).toEqual(["conflict", "linked"]);
    expect([...h.fake.links.keys()]).toEqual([ownerKey(TUPLE, "synthetic-subject-1")]);
  });

  it("needs a separate proof per alias key but shares ownership across aliases", async () => {
    const h = harness();
    const alias = h.factory(configOf({ ...NAMESPACE, key: ALIAS_KEY }));
    const state = await started(h);
    // A flow bound to one key cannot be completed through an alias key for the same tuple.
    expect(await alias.complete(aliasCallback(state))).toEqual({ status: "denied" });
    expect(h.verifierCalls).toEqual([]);
    expect(await h.flow.complete(callback(state))).toEqual({ status: "linked" });
    const record = { ...h.fake.links.values().next().value! };
    h.clock.now = T0 + 5;
    expect(await alias.complete(aliasCallback(await startedVia(alias, ALIAS_KEY)))).toEqual({
      status: "already-linked",
    });
    expect([...h.fake.links.values()]).toEqual([record]);
    // Provisional per-tuple cardinality applies across aliases too.
    const otherState = await startedVia(alias, ALIAS_KEY);
    expect(await alias.complete(aliasCallback(otherState, "code-other"))).toEqual({
      status: "conflict",
    });
    expect(h.fake.links.size).toBe(1);
    expect(h.verifierCalls).toHaveLength(3);
  });

  it("keeps the same subject in different tuples as independent, non-conflicting links", async () => {
    const h = harness();
    const otherNamespace = { ...NAMESPACE, issuer: "https://issuer.invalid/b" };
    const other = h.factory(configOf(otherNamespace));
    const otherTuple = {
      provider: otherNamespace.provider,
      issuer: otherNamespace.issuer,
      environment: otherNamespace.environment,
    };
    expect(await h.flow.complete(callback(await started(h)))).toEqual({ status: "linked" });
    const bobState = await startedVia(other, NAMESPACE.key, "ctx-bob");
    expect(await other.complete(callback(bobState, "code-bob", "ctx-bob"))).toEqual({
      status: "linked",
    });
    // Cardinality is per tuple: alice holds nothing in the other tuple yet.
    const aliceState = await startedVia(other, NAMESPACE.key);
    expect(await other.complete(callback(aliceState, "code-other"))).toEqual({
      status: "linked",
    });
    expect(new Map([...h.fake.links].map(([key, record]) => [key, record.principalId]))).toEqual(
      new Map([
        [ownerKey(TUPLE, "synthetic-subject-1"), "principal-alice"],
        [ownerKey(otherTuple, "synthetic-subject-1"), "principal-bob"],
        [ownerKey(otherTuple, "synthetic-subject-2"), "principal-alice"],
      ]),
    );
  });

  it.each([
    [
      "missing",
      (f: PendingIdentityLinkFlow) =>
        Object.fromEntries(Object.entries(f).filter(([key]) => key !== "namespace")),
    ],
    [
      "malformed",
      (f: PendingIdentityLinkFlow) => ({ ...f, namespace: { ...f.namespace, issuer: "" } }),
    ],
    [
      "carrying an extra field",
      (f: PendingIdentityLinkFlow) => ({
        ...f,
        namespace: { ...f.namespace, key: NAMESPACE.key },
      }),
    ],
    [
      "a substituted provider",
      (f: PendingIdentityLinkFlow) => ({
        ...f,
        namespace: { ...f.namespace, provider: "synthetic-provider-2" },
      }),
    ],
    [
      "a substituted issuer",
      (f: PendingIdentityLinkFlow) => ({
        ...f,
        namespace: { ...f.namespace, issuer: "https://issuer.invalid/b" },
      }),
    ],
    [
      "a substituted environment",
      (f: PendingIdentityLinkFlow) => ({
        ...f,
        namespace: { ...f.namespace, environment: "fixture-b" },
      }),
    ],
  ])("fails closed before the verifier when the consumed tuple is %s", async (_label, alter) => {
    const h = harness({
      deps: (base) => ({
        ...base,
        store: {
          ...base.store,
          consumeIfMatches: async (e: ConsumeExpectation) => {
            const r = await base.store.consumeIfMatches(e);
            return r.status === "consumed" ? { ...r, flow: alter(r.flow) } : r;
          },
        },
      }),
    });
    const state = await started(h);
    expect(await h.flow.complete(callback(state))).toEqual({ status: "unavailable" });
    expect(h.verifierCalls).toEqual([]);
    expect(h.fake.links.size).toBe(0);
  });

  it.each(["provider", "issuer", "environment"] as const)(
    "rejects a finalization whose %s differs from the receipt's original tuple",
    async (field) => {
      const h = harness({
        deps: (base) => ({
          ...base,
          store: {
            ...base.store,
            finalize: async (r: FinalizeLinkRequest) =>
              base.store.finalize({
                ...r,
                assertion: {
                  ...r.assertion,
                  namespace: { ...r.assertion.namespace, [field]: "synthetic-altered" },
                },
              }),
          },
        }),
      });
      const state = await started(h);
      expect(await h.flow.complete(callback(state))).toEqual({ status: "denied" });
      expect(h.fake.links.size).toBe(0);
    },
  );

  it("hands the store and verifier one deeply frozen bound tuple", async () => {
    const seen: IdentityNamespaceTuple[] = [];
    const h = harness({
      deps: (base) => ({
        ...base,
        verify: async (input: IdentityControlVerifierInput) => {
          seen.push(input.namespace);
          return base.verify(input);
        },
        store: {
          insertFresh: async (f: PendingIdentityLinkFlow) => {
            seen.push(f.namespace);
            return base.store.insertFresh(f);
          },
          consumeIfMatches: async (e: ConsumeExpectation) => {
            seen.push(e.namespace);
            return base.store.consumeIfMatches(e);
          },
          finalize: async (r: FinalizeLinkRequest) => {
            seen.push(r.assertion.namespace);
            return base.store.finalize(r);
          },
        },
      }),
    });
    expect(await h.flow.complete(callback(await started(h)))).toEqual({ status: "linked" });
    expect(seen).toHaveLength(4);
    for (const tuple of seen) {
      expect(tuple).toBe(seen[0]);
      expect(tuple).toEqual(TUPLE);
      expect(Object.isFrozen(tuple)).toBe(true);
    }
    expect(() => {
      (seen[0] as { issuer: string }).issuer = "https://issuer.invalid/b";
    }).toThrow(TypeError);
  });
});

describe("fake store contract", () => {
  const flow = (overrides: Partial<PendingIdentityLinkFlow> = {}): PendingIdentityLinkFlow => ({
    namespaceKey: NAMESPACE.key,
    namespace: TUPLE,
    principalId: "principal-alice",
    sessionBinding: "binding-alice-0001",
    stateDigest: sha256("synthetic-state"),
    issuedAtMs: T0,
    expiresAtMs: T0 + TTL,
    ...overrides,
  });
  const expectation = (overrides: Partial<ConsumeExpectation> = {}): ConsumeExpectation => ({
    namespaceKey: NAMESPACE.key,
    namespace: TUPLE,
    principalId: "principal-alice",
    sessionBinding: "binding-alice-0001",
    stateDigest: sha256("synthetic-state"),
    sessionValidUntilMs: T0 + 10 * TTL,
    ...overrides,
  });
  const finalizeRequest = (
    receipt: string,
    subject = "synthetic-subject-1",
  ): FinalizeLinkRequest => ({
    receipt,
    principalId: "principal-alice",
    sessionBinding: "binding-alice-0001",
    assertion: { namespaceKey: NAMESPACE.key, namespace: TUPLE, subject },
    deadlineMs: T0 + TTL,
  });

  it("never overwrites a flow on collision", async () => {
    const fake = createFakeStore({ now: T0 });
    expect(await fake.store.insertFresh(flow())).toEqual({ status: "inserted" });
    expect(await fake.store.insertFresh(flow({ principalId: "principal-bob" }))).toEqual({
      status: "collision",
    });
    expect(fake.flows.get(sha256("synthetic-state"))?.principalId).toBe("principal-alice");
  });

  it("consumes once and issues single-use receipts", async () => {
    const fake = createFakeStore({ now: T0 });
    await fake.store.insertFresh(flow());
    const consumed = await fake.store.consumeIfMatches(expectation());
    expect(consumed.status).toBe("consumed");
    expect(await fake.store.consumeIfMatches(expectation())).toEqual({ status: "rejected" });
    const receipt = (consumed as { receipt: string }).receipt;
    expect(await fake.store.finalize(finalizeRequest(receipt))).toEqual({ status: "linked" });
    expect(await fake.store.finalize(finalizeRequest(receipt))).toEqual({ status: "rejected" });
    expect(await fake.store.finalize(finalizeRequest("receipt-9999999999"))).toEqual({
      status: "rejected",
    });
  });

  it("evaluates expiry with its own clock at the decision point", async () => {
    const clock = { now: T0 };
    const fake = createFakeStore(clock);
    await fake.store.insertFresh(flow());
    const receipt = ((await fake.store.consumeIfMatches(expectation())) as { receipt: string })
      .receipt;
    clock.now = T0 + TTL;
    expect(await fake.store.finalize(finalizeRequest(receipt))).toEqual({ status: "rejected" });
    expect(fake.links.size).toBe(0);
  });

  it("rejects finalization for a principal that no longer exists", async () => {
    const fake = createFakeStore({ now: T0 });
    await fake.store.insertFresh(flow());
    const receipt = ((await fake.store.consumeIfMatches(expectation())) as { receipt: string })
      .receipt;
    fake.principals.delete("principal-alice");
    expect(await fake.store.finalize(finalizeRequest(receipt))).toEqual({ status: "rejected" });
  });

  it("rolls back a failed finalization without a partial link", async () => {
    const fake = createFakeStore({ now: T0 });
    await fake.store.insertFresh(flow());
    const receipt = ((await fake.store.consumeIfMatches(expectation())) as { receipt: string })
      .receipt;
    fake.hooks.finalizeFault = "before-commit";
    await expect(fake.store.finalize(finalizeRequest(receipt))).rejects.toThrow();
    expect(fake.links.size).toBe(0);
    expect(fake.receipts.get(receipt)?.finalized).toBe(false);
  });

  it("enforces unique namespace-subject ownership across principals", async () => {
    const fake = createFakeStore({ now: T0 });
    await fake.store.insertFresh(flow());
    await fake.store.insertFresh(
      flow({
        principalId: "principal-bob",
        sessionBinding: "binding-bob-000001",
        stateDigest: sha256("other"),
      }),
    );
    const a = ((await fake.store.consumeIfMatches(expectation())) as { receipt: string }).receipt;
    const b = (
      (await fake.store.consumeIfMatches(
        expectation({
          principalId: "principal-bob",
          sessionBinding: "binding-bob-000001",
          stateDigest: sha256("other"),
        }),
      )) as { receipt: string }
    ).receipt;
    expect(await fake.store.finalize(finalizeRequest(a))).toEqual({ status: "linked" });
    expect(
      await fake.store.finalize({
        ...finalizeRequest(b),
        principalId: "principal-bob",
        sessionBinding: "binding-bob-000001",
      }),
    ).toEqual({ status: "conflict" });
    expect([...fake.links.values()].map((l) => l.principalId)).toEqual(["principal-alice"]);
  });

  it("rejects consumption with a different tuple and keeps the flow", async () => {
    const fake = createFakeStore({ now: T0 });
    await fake.store.insertFresh(flow());
    expect(
      await fake.store.consumeIfMatches(
        expectation({ namespace: { ...TUPLE, environment: "fixture-b" } }),
      ),
    ).toEqual({ status: "rejected" });
    expect(fake.flows.size).toBe(1);
    expect((await fake.store.consumeIfMatches(expectation())).status).toBe("consumed");
  });

  it("isolates stored and returned tuples so nested mutation cannot retarget a receipt", async () => {
    const fake = createFakeStore({ now: T0 });
    const input = { ...flow(), namespace: { ...TUPLE } };
    await fake.store.insertFresh(input);
    input.namespace.issuer = "https://issuer.invalid/b";
    const consumed = await fake.store.consumeIfMatches(expectation());
    if (consumed.status !== "consumed") throw new Error("not consumed");
    (consumed.flow.namespace as { issuer: string }).issuer = "https://issuer.invalid/b";
    const stored = fake.receipts.get(consumed.receipt)!.flow;
    expect(stored.namespace).toEqual(TUPLE);
    expect(Object.isFrozen(stored.namespace)).toBe(true);
    const altered = finalizeRequest(consumed.receipt);
    expect(
      await fake.store.finalize({
        ...altered,
        assertion: {
          ...altered.assertion,
          namespace: { ...TUPLE, issuer: "https://issuer.invalid/b" },
        },
      }),
    ).toEqual({ status: "rejected" });
    expect(fake.links.size).toBe(0);
    expect(await fake.store.finalize(finalizeRequest(consumed.receipt))).toEqual({
      status: "linked",
    });
    expect([...fake.links.keys()]).toEqual([ownerKey(TUPLE, "synthetic-subject-1")]);
  });

  it("keys ownership by tuple and subject without delimiter collisions", () => {
    const a = ownerKey({ provider: "p", issuer: "i\u0000x", environment: "e" }, "s");
    const b = ownerKey({ provider: "p", issuer: "i", environment: "x\u0000e" }, "s");
    expect(a).not.toBe(b);
    expect(ownerKey(TUPLE, "s")).not.toContain(NAMESPACE.key);
  });
});
