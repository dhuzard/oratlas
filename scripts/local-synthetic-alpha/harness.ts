import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import {
  Agent,
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { PermitAuthority, type Permit, type PermitKind } from "./permits.js";
import {
  isBrandedSyntheticScenario,
  SYNTHETIC_DOMAINS,
  type GatedStage,
  type HttpCase,
  type ProviderCase,
  type StoreOutcome,
  type SyntheticCase,
  type SyntheticDomain,
  type SyntheticScenario,
  type TransportFault,
} from "./scenario.js";

/**
 * Local synthetic effect-ordering fixture (docs/local-synthetic-alpha-ordering.md).
 *
 * One process, one logical sole owner, one FIFO gate per synthetic authorization domain. Every
 * domain mutation (HTTP release, fixed denial, provider start, revocation commit) runs while its
 * operation holds that domain's gate and passes a single-use permit minted and consumed at the
 * actual effect boundary. This is NOT PostgreSQL, distributed, full S1 or G1 evidence, it serves
 * no product route and calls no provider: the HTTP server and client are its own, on 127.0.0.1.
 *
 * Callers choose frozen fixture case ids and domains only. The owner never runs caller code: store
 * and provider behaviour is inert scenario data plus named barriers the test opens. Arbitrary
 * JavaScript cannot be sandboxed, so arbitrary callbacks are not accepted at all.
 */

export const LOOPBACK_HOST = "127.0.0.1";
/** Fixture-local copy of the private cache policy; the root architecture forbids importing apps. */
export const FIXTURE_CACHE_CONTROL = "private, no-store";

const REGISTRY_KEY = Symbol.for("oratlas.local-synthetic-alpha.sole-owner");
const TOKEN_PATH = /^\/op\/([0-9a-f]{32})$/u;
/** Set while owner-private code runs; any public call observed inside it is reentrant. */
const ownerContext = new AsyncLocalStorage<symbol>();

const FIXED_DENIALS = {
  "not-found": { status: 404, body: "not found" },
  unavailable: { status: 503, body: "unavailable" },
} as const;

export type OwnerState = "running" | "poisoned" | "stopped";
export type OperationPhase = "queued" | "held" | "resolving" | "admitted" | "denied" | "settled";
export type OperationKind = "http" | "provider" | "revoke";
export type Decision = "admitted" | "denied" | "invalidated";

export interface TraceEvent {
  readonly seq: number;
  readonly type: string;
  readonly op?: string;
  readonly domain?: SyntheticDomain;
  readonly generation?: number;
  readonly detail?: string;
}

export interface TransportSnapshot {
  readonly handoffAttempted: boolean;
  readonly finishObserved: boolean;
  readonly terminalFailure: boolean;
  readonly clientReceived: boolean;
}

export interface OperationSnapshot {
  readonly id: string;
  readonly kind: OperationKind;
  readonly domain: SyntheticDomain;
  readonly caseId: string | null;
  readonly expectedGeneration: number | null;
  readonly phase: OperationPhase;
  readonly decision: Decision | null;
  readonly reason: string | null;
  readonly cancelRequested: boolean;
  readonly transportLost: boolean;
  readonly transport: TransportSnapshot | null;
}

export interface ClientObservation {
  readonly status: number | null;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly bytes: number;
  readonly complete: boolean;
  readonly error: string | null;
}

export interface ProviderJob {
  readonly opId: string;
  readonly domain: SyntheticDomain;
  readonly caseId: string;
  readonly generation: number;
  readonly job: string;
}

export interface OwnerSnapshot {
  readonly state: OwnerState;
  readonly domains: Readonly<
    Record<
      SyntheticDomain,
      {
        readonly generation: number;
        readonly revoked: boolean;
        readonly queued: number;
        readonly active: string | null;
      }
    >
  >;
  readonly jobs: readonly ProviderJob[];
}

export interface TeardownReport {
  readonly priorState: OwnerState;
  readonly listenerClosed: boolean;
  readonly socketsClosed: boolean;
  readonly registryReleased: boolean;
  /** Operations that held a gate when the owner stopped, with their transport flags. */
  readonly outstanding: readonly OperationSnapshot[];
}

export interface RequestHandle {
  readonly id: string;
  /** `true` once the server received the request and queued it; `false` if it never queued. */
  readonly queued: Promise<boolean>;
  /** What the fixture's own client actually received over the socket. */
  readonly response: Promise<ClientObservation>;
  readonly outcome: Promise<OperationSnapshot>;
  /** Owner-level withdrawal. Returns false when the effect was already admitted (no recall). */
  cancel(): boolean;
  /** Simulates connection loss by destroying the fixture client's socket. */
  abortTransport(): void;
}

export interface ProviderHandle {
  readonly id: string;
  readonly outcome: Promise<OperationSnapshot>;
  /** Inert completion record of an admitted job; `"ignored"` after stop, never a new effect. */
  readonly completion: Promise<"ok" | "error" | "ignored" | "not-started">;
  cancel(): boolean;
}

export interface RevokeHandle {
  readonly id: string;
  readonly outcome: Promise<OperationSnapshot>;
}

export interface SyntheticHarness {
  readonly origin: string;
  request(caseId: string): RequestHandle;
  runSyntheticProvider(caseId: string): ProviderHandle;
  revoke(domain: SyntheticDomain): RevokeHandle;
  stop(): Promise<TeardownReport>;
  readonly barriers: {
    reached(opId: string, stage: GatedStage): Promise<void>;
    open(opId: string, stage: GatedStage): void;
  };
  trace(): readonly TraceEvent[];
  waitForTrace(type: string, opId?: string): Promise<TraceEvent>;
  status(): OwnerSnapshot;
  operation(opId: string): OperationSnapshot;
}

export class SyntheticHarnessError extends Error {
  override readonly name = "SyntheticHarnessError";
}

class SyntheticStoreError extends Error {
  override readonly name = "SyntheticStoreError";
}

class SyntheticTransportFault extends Error {
  override readonly name = "SyntheticTransportFault";
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly isSettled: () => boolean;
}

function deferred<T>(): Deferred<T> {
  let settle!: (value: T) => void;
  let settled = false;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      if (settled) return;
      settled = true;
      settle(value);
    },
    isSettled: () => settled,
  };
}

interface HttpTransport {
  readonly token: string;
  res: ServerResponse | null;
  clientRequest: ClientRequest | null;
  handoffAttempted: boolean;
  finishObserved: boolean;
  terminalFailure: boolean;
  clientReceived: boolean;
  readonly client: Deferred<ClientObservation>;
}

interface Operation {
  readonly id: string;
  readonly kind: OperationKind;
  readonly domain: SyntheticDomain;
  readonly caseId: string | null;
  readonly spec: SyntheticCase | null;
  expectedGeneration: number | null;
  phase: OperationPhase;
  decision: Decision | null;
  reason: string | null;
  cancelRequested: boolean;
  transportLost: boolean;
  readonly http: HttpTransport | null;
  readonly done: Deferred<OperationSnapshot>;
  readonly queued: Deferred<boolean>;
  readonly completion: Deferred<"ok" | "error" | "ignored" | "not-started">;
}

interface DomainGate {
  generation: number;
  revoked: boolean;
  readonly queue: Operation[];
  active: Operation | null;
}

type BoundaryResult = "finished" | "terminal" | "rejected";

function fixedHeaders(body: string): Record<string, string> {
  return {
    "Cache-Control": FIXTURE_CACHE_CONTROL,
    Vary: "Cookie",
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    "X-Content-Type-Options": "nosniff",
    Connection: "close",
  };
}

function registry(): Record<symbol, symbol | undefined> {
  return globalThis as unknown as Record<symbol, symbol | undefined>;
}

class SyntheticOwner {
  #state: OwnerState = "running";
  readonly #scenario: SyntheticScenario;
  readonly #marker: symbol;
  readonly #domains: Record<SyntheticDomain, DomainGate>;
  readonly #ops = new Map<string, Operation>();
  readonly #pendingTokens = new Map<string, Operation>();
  readonly #permits = new PermitAuthority();
  readonly #trace: TraceEvent[] = [];
  readonly #traceWaiters: { type: string; op?: string; found: Deferred<TraceEvent> }[] = [];
  readonly #barriers = new Map<string, { reached: Deferred<void>; opened: Deferred<void> }>();
  readonly #jobs: ProviderJob[] = [];
  /** Every socket this owner opened or accepted, with its side and a close signal. */
  readonly #openSockets = new Map<Socket, { side: "server" | "client"; closed: Deferred<void> }>();
  readonly #server: Server;
  readonly #agent = new Agent({ keepAlive: false });
  #port = 0;
  #nextId = 1;
  #stopping: Promise<TeardownReport> | null = null;

  constructor(scenario: SyntheticScenario, marker: symbol) {
    this.#scenario = scenario;
    this.#marker = marker;
    const gate = (): DomainGate => ({ generation: 1, revoked: false, queue: [], active: null });
    this.#domains = { alpha: gate(), beta: gate() };
    // Finite, fixed responses only: no upgrade, CONNECT, 100-continue or expectation handling.
    this.#server = createServer();
    this.#server.on("connection", (socket) => this.#track(socket, "server"));
    this.#server.on("request", (req, res) => this.#onRequest(req, res));
    this.#server.on("checkContinue", (req, res) => this.#onForeign(req, res));
    this.#server.on("checkExpectation", (req, res) => this.#onForeign(req, res));
    this.#server.on("upgrade", (_req, socket) => socket.destroy());
    this.#server.on("connect", (_req, socket) => socket.destroy());
    this.#server.on("clientError", (_error, socket) => socket.destroy());
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true }, () => {
        this.#server.off("error", reject);
        resolve();
      });
    });
    const address = this.#server.address() as AddressInfo | null;
    if (address?.address !== LOOPBACK_HOST || address.family !== "IPv4") {
      throw new SyntheticHarnessError("listener is not the literal IPv4 loopback address");
    }
    this.#port = address.port;
    this.#emit("owner.listening", { detail: `${LOOPBACK_HOST}:ephemeral` });
  }

  /** Close a listener that failed its checks; resolves true when nothing is listening. */
  async closeFailedListener(): Promise<boolean> {
    if (this.#server.listening) {
      await new Promise<void>((resolve) => this.#server.close(() => resolve()));
    }
    return !this.#server.listening;
  }

  api(): SyntheticHarness {
    const barriers = Object.freeze({
      reached: (opId: string, stage: GatedStage) => this.#barrierFor(opId, stage).reached.promise,
      open: (opId: string, stage: GatedStage) => {
        this.#assertNotReentrant("barrier.open");
        const barrier = this.#barrierFor(opId, stage);
        if (!barrier.opened.isSettled()) this.#emit("barrier.opened", { op: opId, detail: stage });
        barrier.opened.resolve();
      },
    });
    return Object.freeze({
      origin: `http://${LOOPBACK_HOST}:${this.#port}`,
      request: (caseId: string) => this.#request(caseId),
      runSyntheticProvider: (caseId: string) => this.#runSyntheticProvider(caseId),
      revoke: (domain: SyntheticDomain) => this.#revoke(domain),
      stop: () => this.#stop(),
      barriers,
      trace: () => Object.freeze(this.#trace.slice()),
      waitForTrace: (type: string, opId?: string) => this.#waitForTrace(type, opId),
      status: () => this.#status(),
      operation: (opId: string) => this.#snapshot(this.#op(opId)),
    });
  }

  // ---- public operations -------------------------------------------------------------------

  #request(caseId: string): RequestHandle {
    this.#assertCallable("request");
    const spec = this.#case(caseId, "http") as HttpCase;
    const op = this.#newOperation("http", spec.domain, caseId, spec);
    this.#pendingTokens.set(op.http!.token, op);
    this.#startClient(op);
    return Object.freeze({
      id: op.id,
      queued: op.queued.promise,
      response: op.http!.client.promise,
      outcome: op.done.promise,
      cancel: () => this.#cancel(op),
      abortTransport: () => {
        this.#assertNotReentrant("abortTransport");
        op.http!.clientRequest?.destroy();
      },
    });
  }

  #runSyntheticProvider(caseId: string): ProviderHandle {
    this.#assertCallable("runSyntheticProvider");
    const spec = this.#case(caseId, "provider") as ProviderCase;
    const op = this.#newOperation("provider", spec.domain, caseId, spec);
    this.#enqueue(op);
    return Object.freeze({
      id: op.id,
      outcome: op.done.promise,
      completion: op.completion.promise,
      cancel: () => this.#cancel(op),
    });
  }

  #revoke(domain: SyntheticDomain): RevokeHandle {
    this.#assertCallable("revoke");
    if (typeof domain !== "string" || !(SYNTHETIC_DOMAINS as readonly string[]).includes(domain)) {
      throw new SyntheticHarnessError("unknown synthetic domain");
    }
    const op = this.#newOperation("revoke", domain, null, null);
    this.#enqueue(op);
    return Object.freeze({ id: op.id, outcome: op.done.promise });
  }

  #cancel(op: Operation): boolean {
    this.#assertNotReentrant("cancel");
    this.#emit("op.cancel.requested", { op: op.id, domain: op.domain });
    if (op.decision !== null || op.phase === "admitted" || op.phase === "settled") {
      // Already admitted, denied or invalidated: an admitted effect is never recalled.
      this.#emit("op.cancel.ignored", { op: op.id, domain: op.domain, detail: op.phase });
      return false;
    }
    op.cancelRequested = true;
    return true;
  }

  #stop(): Promise<TeardownReport> {
    this.#assertNotReentrant("stop");
    this.#stopping ??= this.#teardown();
    return this.#stopping;
  }

  // ---- gate ---------------------------------------------------------------------------------

  #enqueue(op: Operation): void {
    const gate = this.#domains[op.domain];
    // The expected generation is captured when the operation is queued, not when it runs.
    op.expectedGeneration = gate.generation;
    op.phase = "queued";
    gate.queue.push(op);
    this.#emit(op.kind === "revoke" ? "revoke.queued" : "op.queued", {
      op: op.id,
      domain: op.domain,
      generation: gate.generation,
    });
    op.queued.resolve(true);
    this.#pump(op.domain);
  }

  #pump(domain: SyntheticDomain): void {
    const gate = this.#domains[domain];
    if (this.#state !== "running" || gate.active) return;
    const next = gate.queue.shift();
    if (!next) return;
    gate.active = next;
    next.phase = "held";
    this.#emit("op.held", { op: next.id, domain, generation: gate.generation });
    ownerContext.run(this.#marker, () => {
      this.#execute(next).catch(() => this.#poison("internal-error", next));
    });
  }

  async #execute(op: Operation): Promise<void> {
    if (op.kind === "revoke") return this.#runRevoke(op);
    if (op.kind === "provider") return this.#runProvider(op);
    return this.#runHttp(op);
  }

  /** Release only on definitive settlement, never on a timeout, cancellation or connection loss. */
  #release(op: Operation): void {
    const gate = this.#domains[op.domain];
    if (gate.active !== op || this.#state !== "running") return;
    op.phase = "settled";
    gate.active = null;
    this.#emit("op.settled", { op: op.id, domain: op.domain, detail: op.decision ?? undefined });
    op.done.resolve(this.#snapshot(op));
    this.#pump(op.domain);
  }

  /** Reason to deny a held operation without any protected effect, or null when authorized. */
  #authorizationFailure(op: Operation): string | null {
    const gate = this.#domains[op.domain];
    if (op.cancelRequested) return "cancelled";
    if (op.transportLost) return "transport-lost-while-queued";
    if (gate.revoked || gate.generation !== op.expectedGeneration) return "revoked-or-stale";
    return null;
  }

  /** After any await under the gate: a non-running owner ignores the late, inert continuation. */
  #stillRunning(op: Operation): boolean {
    if (this.#state === "running") return true;
    this.#emit("late-resolution.ignored", { op: op.id, domain: op.domain, detail: this.#state });
    return false;
  }

  async #resolveStore(op: Operation, outcome: StoreOutcome): Promise<StoreOutcome> {
    op.phase = "resolving";
    this.#emit("store.resolving", { op: op.id, domain: op.domain });
    if (op.spec!.gated.includes("store")) await this.#barrier(op, "store");
    this.#emit("store.resolved", { op: op.id, domain: op.domain, detail: outcome });
    if (outcome === "error") throw new SyntheticStoreError("synthetic store error");
    return outcome;
  }

  async #storeOutcome(op: Operation, outcome: StoreOutcome): Promise<StoreOutcome> {
    try {
      return await this.#resolveStore(op, outcome);
    } catch (error) {
      // A definitive, ordinary rejection before any effect was delegated: safe to deny and release.
      if (error instanceof SyntheticStoreError) return "error";
      throw error;
    }
  }

  // ---- revocation -------------------------------------------------------------------------

  #runRevoke(op: Operation): void {
    const gate = this.#domains[op.domain];
    const permit = this.#mint(op, "revoke-commit");
    if (!this.#consume(op, permit, "revoke-commit")) return this.#poison("permit-rejected", op);
    gate.generation += 1;
    gate.revoked = true;
    op.phase = "admitted";
    op.decision = "admitted";
    op.reason = "committed";
    this.#emit("revoke.commit", { op: op.id, domain: op.domain, generation: gate.generation });
    this.#release(op);
  }

  // ---- provider -----------------------------------------------------------------------------

  async #runProvider(op: Operation): Promise<void> {
    const spec = op.spec as ProviderCase;
    const early = this.#authorizationFailure(op);
    if (early) return this.#denyWithoutEffect(op, early);
    const outcome = await this.#storeOutcome(op, spec.store);
    if (!this.#stillRunning(op)) return;
    if (spec.gated.includes("pre-boundary")) {
      await this.#barrier(op, "pre-boundary");
      if (!this.#stillRunning(op)) return;
    }
    const late = this.#authorizationFailure(op);
    if (late) return this.#denyWithoutEffect(op, late);
    if (outcome !== "allow") {
      return this.#denyWithoutEffect(op, outcome === "deny" ? "store-denied" : "store-error");
    }
    const permit = this.#mint(op, "provider-start");
    if (!this.#admitProvider(op, permit, spec)) return this.#poison("permit-rejected", op);
    this.#release(op);
    this.#completeProvider(op, spec).catch(() => this.#poison("internal-error", op));
  }

  /** Synchronous, owner-controlled admission: records a frozen job; no provider network exists. */
  #admitProvider(op: Operation, permit: Permit, spec: ProviderCase): boolean {
    if (!this.#consume(op, permit, "provider-start")) return false;
    const job: ProviderJob = Object.freeze({
      opId: op.id,
      domain: op.domain,
      caseId: op.caseId!,
      generation: this.#domains[op.domain].generation,
      job: spec.job,
    });
    this.#jobs.push(job);
    op.phase = "admitted";
    op.decision = "admitted";
    op.reason = "started";
    this.#emit("provider.admitted", { op: op.id, domain: op.domain, generation: job.generation });
    return true;
  }

  /** Records the inert completion. It holds no permit and can never start another effect. */
  async #completeProvider(op: Operation, spec: ProviderCase): Promise<void> {
    if (spec.gated.includes("completion")) await this.#barrier(op, "completion");
    if (this.#state === "stopped") {
      this.#emit("provider.completion.ignored", { op: op.id, domain: op.domain });
      op.completion.resolve("ignored");
      return;
    }
    // A failure after admission does not erase the start: the job record stays.
    this.#emit(spec.completion === "ok" ? "provider.completed" : "provider.failed", {
      op: op.id,
      domain: op.domain,
    });
    op.completion.resolve(spec.completion);
  }

  #denyWithoutEffect(op: Operation, reason: string): void {
    op.phase = "denied";
    op.decision = "denied";
    op.reason = reason;
    this.#emit("op.denied", { op: op.id, domain: op.domain, detail: reason });
    op.completion.resolve("not-started");
    this.#release(op);
  }

  // ---- HTTP ---------------------------------------------------------------------------------

  async #runHttp(op: Operation): Promise<void> {
    const spec = op.spec as HttpCase;
    const early = this.#authorizationFailure(op);
    if (early) return this.#denyHttp(op, early);
    const outcome = await this.#storeOutcome(op, spec.store);
    if (!this.#stillRunning(op)) return;
    if (spec.gated.includes("pre-boundary")) {
      await this.#barrier(op, "pre-boundary");
      if (!this.#stillRunning(op)) return;
    }
    const late = this.#authorizationFailure(op);
    if (late) return this.#denyHttp(op, late);
    if (outcome !== "allow") {
      return this.#denyHttp(op, outcome === "deny" ? "store-denied" : "store-error");
    }
    const permit = this.#mint(op, "http-release");
    const result = await this.#httpBoundary(
      op,
      permit,
      "http-release",
      { status: 200, body: spec.body },
      spec.transportFault,
      "released",
    );
    this.#afterHttp(op, result);
  }

  /** Fixed, owner-generated denial through the same controlled boundary, under the same gate. */
  async #denyHttp(op: Operation, reason: string): Promise<void> {
    if (!op.http!.res || op.transportLost) {
      // Lost while queued: there is no transport to answer on and nothing is handed off.
      return this.#denyWithoutEffect(op, reason);
    }
    const denial =
      reason === "cancelled" || reason === "store-error"
        ? FIXED_DENIALS.unavailable
        : FIXED_DENIALS["not-found"];
    const permit = this.#mint(op, "http-denial");
    const result = await this.#httpBoundary(op, permit, "http-denial", denial, "none", reason);
    this.#afterHttp(op, result);
  }

  #afterHttp(op: Operation, result: BoundaryResult): void {
    if (result === "finished") return this.#release(op);
    // A terminal transport failure is ambiguous (bytes may have left): poison, never release.
    if (result === "terminal") return this.#poison("transport-terminal", op);
    // A rejected permit while running means an owner invariant failed: fail closed.
    if (this.#state === "running") this.#poison("permit-rejected", op);
  }

  /**
   * The HTTP effect boundary. Consumes the permit, installs finish/error/close handlers, then
   * performs one synchronous `writeHead` + `end(fixedBody)`; resolves when Node reports `finish`
   * (handed to the OS, not client receipt) or a terminal transport failure.
   */
  #httpBoundary(
    op: Operation,
    permit: Permit,
    kind: "http-release" | "http-denial",
    response: { status: number; body: string },
    fault: TransportFault,
    reason: string,
  ): Promise<BoundaryResult> {
    const transport = op.http!;
    const res = transport.res!;
    if (!this.#consume(op, permit, kind)) return Promise.resolve("rejected");
    op.phase = kind === "http-release" ? "admitted" : "denied";
    op.decision = kind === "http-release" ? "admitted" : "denied";
    op.reason = reason;
    const settlement = new Promise<BoundaryResult>((resolve) => {
      res.once("finish", () => {
        transport.finishObserved = true;
        this.#emit("http.finish", { op: op.id, domain: op.domain });
        resolve("finished");
      });
      res.once("error", () => {
        transport.terminalFailure = true;
        this.#emit("http.terminal", { op: op.id, domain: op.domain, detail: "error" });
        resolve("terminal");
      });
      res.once("close", () => {
        if (transport.finishObserved) return;
        transport.terminalFailure = true;
        this.#emit("http.terminal", { op: op.id, domain: op.domain, detail: "close" });
        resolve("terminal");
      });
    });
    transport.handoffAttempted = true;
    this.#emit("http.handoff", { op: op.id, domain: op.domain, detail: `${response.status}` });
    try {
      if (fault === "socket-destroyed-at-handoff") res.socket?.destroy();
      res.sendDate = false;
      res.writeHead(response.status, fixedHeaders(response.body));
      res.end(response.body);
      if (fault === "end-throws-after-end") throw new SyntheticTransportFault("after end");
    } catch {
      // A throw may follow a partial hand-off. Never retry: destroy and classify as terminal.
      transport.terminalFailure = true;
      this.#emit("http.handoff.threw", { op: op.id, domain: op.domain });
      res.socket?.destroy();
      res.destroy();
      return Promise.resolve("terminal");
    }
    return settlement;
  }

  #onRequest(req: IncomingMessage, res: ServerResponse): void {
    req.resume();
    if (this.#state !== "running") {
      res.socket?.destroy();
      return;
    }
    const token = req.method === "GET" ? TOKEN_PATH.exec(req.url ?? "")?.[1] : undefined;
    const op = token === undefined ? undefined : this.#pendingTokens.get(token);
    if (!op) return this.#writeUnrouted(res);
    this.#pendingTokens.delete(token!);
    op.http!.res = res;
    res.on("close", () => this.#onServerClose(op));
    this.#enqueue(op);
  }

  #onForeign(req: IncomingMessage, res: ServerResponse): void {
    req.resume();
    if (this.#state !== "running") {
      res.socket?.destroy();
      return;
    }
    this.#writeUnrouted(res);
  }

  /** Requests that are not a pending fixture operation touch no domain and get a fixed 404. */
  #writeUnrouted(res: ServerResponse): void {
    this.#emit("http.unrouted", {});
    const { status, body } = FIXED_DENIALS["not-found"];
    res.sendDate = false;
    res.writeHead(status, fixedHeaders(body));
    res.end(body);
  }

  #onServerClose(op: Operation): void {
    const transport = op.http!;
    if (transport.finishObserved || op.transportLost) return;
    op.transportLost = true;
    this.#emit("transport.lost", { op: op.id, domain: op.domain, detail: op.phase });
    // Connection loss alone never releases a held gate: the owner is poisoned instead. A queued
    // operation holds nothing; it is denied without effect when it reaches the front.
    if (this.#state === "running" && this.#domains[op.domain].active === op) {
      this.#poison("transport-lost", op);
    }
  }

  #startClient(op: Operation): void {
    const transport = op.http!;
    const req = httpRequest({
      host: LOOPBACK_HOST,
      port: this.#port,
      method: "GET",
      path: `/op/${transport.token}`,
      agent: this.#agent,
      headers: { connection: "close" },
    });
    transport.clientRequest = req;
    let responded = false;
    const observe = (
      status: number | null,
      headers: Record<string, string>,
      chunks: Buffer[],
      complete: boolean,
      error: string | null,
    ) => {
      const body = Buffer.concat(chunks);
      transport.client.resolve(
        Object.freeze({
          status,
          headers: Object.freeze(headers),
          body: body.toString("utf8"),
          bytes: body.length,
          complete,
          error,
        }),
      );
    };
    req.on("socket", (socket) => this.#track(socket, "client"));
    req.on("response", (incoming) => {
      responded = true;
      const chunks: Buffer[] = [];
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === "string") headers[name] = value;
      }
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("end", () => {
        const bytes = chunks.reduce((total, chunk) => total + chunk.length, 0);
        const complete = incoming.complete && bytes === Number(headers["content-length"]);
        if (complete) {
          transport.clientReceived = true;
          this.#emit("http.client.received", { op: op.id, domain: op.domain, detail: `${bytes}` });
        }
        observe(incoming.statusCode ?? null, headers, chunks, complete, null);
      });
      incoming.on("close", () => {
        observe(incoming.statusCode ?? null, headers, chunks, false, "response-closed");
      });
    });
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (!responded) observe(null, {}, [], false, error.code ?? "client-error");
    });
    req.on("close", () => {
      if (responded) return;
      observe(null, {}, [], false, "closed-without-response");
      // Never reached the server: the operation was never queued and holds nothing.
      if (this.#pendingTokens.get(transport.token) === op) {
        this.#pendingTokens.delete(transport.token);
        op.transportLost = true;
        this.#invalidate(op, "transport-lost-before-queue");
      }
    });
    req.end();
  }

  // ---- permits ------------------------------------------------------------------------------

  #mint(op: Operation, kind: PermitKind): Permit {
    const generation = this.#domains[op.domain].generation;
    this.#emit("permit.minted", { op: op.id, domain: op.domain, generation, detail: kind });
    return this.#permits.mint({ domain: op.domain, generation, operationId: op.id, kind });
  }

  /** Consume at the effect boundary, rechecking owner state, gate holder, cancellation and auth. */
  #consume(op: Operation, permit: Permit, kind: PermitKind): boolean {
    const gate = this.#domains[op.domain];
    let verdict: string = this.#permits.consume(permit, {
      domain: op.domain,
      generation: gate.generation,
      operationId: op.id,
      kind,
    });
    if (verdict === "accepted") {
      if (this.#state !== "running") verdict = `owner-${this.#state}`;
      else if (gate.active !== op) verdict = "not-gate-holder";
      else if (op.transportLost) verdict = "transport-lost";
      else if (
        (kind === "http-release" || kind === "provider-start") &&
        (op.cancelRequested || gate.revoked || gate.generation !== op.expectedGeneration)
      ) {
        verdict = "stale-or-cancelled";
      }
    }
    const accepted = verdict === "accepted";
    this.#emit(accepted ? "permit.consumed" : "permit.rejected", {
      op: op.id,
      domain: op.domain,
      generation: gate.generation,
      detail: accepted ? kind : `${kind}:${verdict}`,
    });
    return accepted;
  }

  // ---- poison, stop, registry ---------------------------------------------------------------

  /**
   * Fail closed: reject new work, invalidate every queued or active operation, destroy transports
   * and keep gate ownership (an active operation stays the holder; queued revokers never commit).
   */
  #poison(reason: string, op?: Operation): void {
    if (this.#state !== "running") return;
    this.#state = "poisoned";
    this.#emit("owner.poisoned", { op: op?.id, domain: op?.domain, detail: reason });
    this.#invalidateAll("owner-poisoned");
    this.#destroyServerTransports();
  }

  #invalidateAll(reason: string): Operation[] {
    const active: Operation[] = [];
    for (const domain of SYNTHETIC_DOMAINS) {
      const gate = this.#domains[domain];
      for (const queued of gate.queue) this.#invalidate(queued, reason);
      if (gate.active) {
        active.push(gate.active);
        this.#invalidate(gate.active, reason);
      }
    }
    for (const pending of this.#pendingTokens.values()) this.#invalidate(pending, reason);
    return active;
  }

  #invalidate(op: Operation, reason: string): void {
    if (op.done.isSettled()) return;
    if (op.decision === null) {
      op.decision = "invalidated";
      op.reason = reason;
    }
    this.#emit("op.invalidated", { op: op.id, domain: op.domain, detail: reason });
    op.queued.resolve(false);
    if (op.decision !== "admitted") op.completion.resolve("not-started");
    op.done.resolve(this.#snapshot(op));
  }

  /**
   * Poison destroys the owner's egress (server-side sockets) only. The fixture's client sockets
   * then observe the closure like any remote client would, so bytes that `finish` reported as
   * handed to the OS may or may not have been received: finish is not receipt.
   */
  #destroyServerTransports(): void {
    for (const [socket, { side }] of this.#openSockets) if (side === "server") socket.destroy();
  }

  #destroyAllTransports(): void {
    for (const socket of this.#openSockets.keys()) socket.destroy();
    for (const op of this.#ops.values()) op.http?.clientRequest?.destroy();
  }

  async #teardown(): Promise<TeardownReport> {
    const priorState = this.#state;
    this.#state = "stopped";
    this.#emit("owner.stopped", { detail: priorState });
    const outstanding = this.#invalidateAll("owner-stopped").map((op) => this.#snapshot(op));
    this.#destroyAllTransports();
    this.#agent.destroy();
    const closed = new Promise<void>((resolve) => this.#server.close(() => resolve()));
    this.#server.closeAllConnections();
    await closed;
    await Promise.all([...this.#openSockets.values()].map(({ closed: done }) => done.promise));
    const listenerClosed = !this.#server.listening;
    const socketsClosed = this.#openSockets.size === 0;
    // The registry is cleared only after capability termination is shown: state is stopped (every
    // permit is refused), the listener is closed and every tracked socket has closed.
    let registryReleased = false;
    if (listenerClosed && socketsClosed && registry()[REGISTRY_KEY] === this.#marker) {
      delete registry()[REGISTRY_KEY];
      registryReleased = true;
    }
    this.#emit("owner.teardown", {
      detail: `listener=${listenerClosed} sockets=${socketsClosed} registry=${registryReleased}`,
    });
    return Object.freeze({
      priorState,
      listenerClosed,
      socketsClosed,
      registryReleased,
      outstanding: Object.freeze(outstanding),
    });
  }

  // ---- helpers ------------------------------------------------------------------------------

  #assertNotReentrant(method: string): void {
    if (ownerContext.getStore() === undefined) return;
    this.#emit("reentry.rejected", { detail: method });
    throw new SyntheticHarnessError(`reentrant ${method} rejected`);
  }

  #assertCallable(method: string): void {
    this.#assertNotReentrant(method);
    if (this.#state !== "running") {
      throw new SyntheticHarnessError(`${method} rejected: owner is ${this.#state}`);
    }
  }

  #case(caseId: string, kind: SyntheticCase["kind"]): SyntheticCase {
    const spec = typeof caseId === "string" ? this.#scenario.cases[caseId] : undefined;
    if (!spec || spec.kind !== kind) throw new SyntheticHarnessError("unknown fixture case");
    return spec;
  }

  #newOperation(
    kind: OperationKind,
    domain: SyntheticDomain,
    caseId: string | null,
    spec: SyntheticCase | null,
  ): Operation {
    const id = `op-${this.#nextId++}`;
    const op: Operation = {
      id,
      kind,
      domain,
      caseId,
      spec,
      expectedGeneration: null,
      phase: "queued",
      decision: null,
      reason: null,
      cancelRequested: false,
      transportLost: false,
      http:
        kind === "http"
          ? {
              token: randomBytes(16).toString("hex"),
              res: null,
              clientRequest: null,
              handoffAttempted: false,
              finishObserved: false,
              terminalFailure: false,
              clientReceived: false,
              client: deferred<ClientObservation>(),
            }
          : null,
      done: deferred<OperationSnapshot>(),
      queued: deferred<boolean>(),
      completion: deferred<"ok" | "error" | "ignored" | "not-started">(),
    };
    this.#ops.set(id, op);
    this.#emit("op.created", { op: id, domain, detail: caseId ?? kind });
    return op;
  }

  #op(opId: string): Operation {
    const op = this.#ops.get(opId);
    if (!op) throw new SyntheticHarnessError("unknown operation");
    return op;
  }

  #barrierFor(opId: string, stage: GatedStage) {
    const op = this.#op(opId);
    if (!op.spec?.gated.includes(stage)) {
      throw new SyntheticHarnessError(`operation is not gated at ${stage}`);
    }
    const key = `${opId}:${stage}`;
    let barrier = this.#barriers.get(key);
    if (!barrier) {
      barrier = { reached: deferred<void>(), opened: deferred<void>() };
      this.#barriers.set(key, barrier);
    }
    return barrier;
  }

  async #barrier(op: Operation, stage: GatedStage): Promise<void> {
    const barrier = this.#barrierFor(op.id, stage);
    this.#emit("barrier.reached", { op: op.id, domain: op.domain, detail: stage });
    barrier.reached.resolve();
    await barrier.opened.promise;
  }

  #track(socket: Socket, side: "server" | "client"): void {
    if (this.#openSockets.has(socket)) return;
    const closed = deferred<void>();
    this.#openSockets.set(socket, { side, closed });
    socket.once("close", () => {
      this.#openSockets.delete(socket);
      closed.resolve();
    });
    if (this.#state !== "running") socket.destroy();
  }

  #emit(type: string, fields: Omit<TraceEvent, "seq" | "type">): void {
    const event: TraceEvent = Object.freeze({ seq: this.#trace.length + 1, type, ...fields });
    this.#trace.push(event);
    for (let index = this.#traceWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.#traceWaiters[index]!;
      if (waiter.type === type && (waiter.op === undefined || waiter.op === event.op)) {
        this.#traceWaiters.splice(index, 1);
        waiter.found.resolve(event);
      }
    }
  }

  #waitForTrace(type: string, opId?: string): Promise<TraceEvent> {
    const existing = this.#trace.find(
      (event) => event.type === type && (opId === undefined || event.op === opId),
    );
    if (existing) return Promise.resolve(existing);
    const found = deferred<TraceEvent>();
    this.#traceWaiters.push({ type, op: opId, found });
    return found.promise;
  }

  #snapshot(op: Operation): OperationSnapshot {
    const transport = op.http;
    return Object.freeze({
      id: op.id,
      kind: op.kind,
      domain: op.domain,
      caseId: op.caseId,
      expectedGeneration: op.expectedGeneration,
      phase: op.phase,
      decision: op.decision,
      reason: op.reason,
      cancelRequested: op.cancelRequested,
      transportLost: op.transportLost,
      transport: transport
        ? Object.freeze({
            handoffAttempted: transport.handoffAttempted,
            finishObserved: transport.finishObserved,
            terminalFailure: transport.terminalFailure,
            clientReceived: transport.clientReceived,
          })
        : null,
    });
  }

  #status(): OwnerSnapshot {
    const domains = Object.fromEntries(
      SYNTHETIC_DOMAINS.map((domain) => {
        const gate = this.#domains[domain];
        return [
          domain,
          Object.freeze({
            generation: gate.generation,
            revoked: gate.revoked,
            queued: gate.queue.length,
            active: gate.active?.id ?? null,
          }),
        ];
      }),
    ) as OwnerSnapshot["domains"];
    return Object.freeze({
      state: this.#state,
      domains: Object.freeze(domains),
      jobs: Object.freeze(this.#jobs.slice()),
    });
  }
}

/**
 * Create the process's sole synthetic owner. The process-global registry is claimed before the
 * listener exists and is one-shot per owner: a second owner is refused while one is live or
 * poisoned, and only a verified teardown releases it. This does not guard against another OS
 * process or production instances.
 */
export async function createHarness(scenario: SyntheticScenario): Promise<SyntheticHarness> {
  if (ownerContext.getStore() !== undefined) {
    throw new SyntheticHarnessError("reentrant createHarness rejected");
  }
  if (!isBrandedSyntheticScenario(scenario)) {
    throw new SyntheticHarnessError("scenario must come from defineSyntheticScenario");
  }
  if (registry()[REGISTRY_KEY] !== undefined) {
    throw new SyntheticHarnessError("a synthetic owner is already registered in this process");
  }
  const marker = Symbol("local-synthetic-alpha-owner");
  registry()[REGISTRY_KEY] = marker;
  const owner = new SyntheticOwner(scenario, marker);
  try {
    await owner.listen();
  } catch (error) {
    // Release only when nothing is listening; otherwise stay registered (fail closed, no reuse).
    if ((await owner.closeFailedListener()) && registry()[REGISTRY_KEY] === marker) {
      delete registry()[REGISTRY_KEY];
    }
    throw error;
  }
  return owner.api();
}

/**
 * Test-only probe: runs `probe` as if inside owner-private code so the reentrancy guard can be
 * falsified. It grants no capability: the owner context is only ever consulted to refuse calls.
 */
export function simulateOwnerContextForTesting<T>(probe: () => T): T {
  return ownerContext.run(Symbol("reentrancy-probe"), probe);
}
