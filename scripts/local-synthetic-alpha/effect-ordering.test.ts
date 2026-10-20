import { get } from "node:http";
import { connect } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createHarness,
  FIXTURE_CACHE_CONTROL,
  LOOPBACK_HOST,
  simulateOwnerContextForTesting,
  type SyntheticHarness,
} from "./harness.js";
import { SYNTHETIC_ALPHA_SCENARIO } from "./scenario.js";

/*
 * Deterministic ordering tests for the local synthetic effect-ordering fixture
 * (docs/local-synthetic-alpha-ordering.md). Interleavings are forced with named barriers and
 * awaited trace/transport events, never with sleeps or timers. Positive authority is asserted on
 * what the fixture's real loopback client received and on recorded provider jobs, not only on the
 * owner's own trace.
 */

const BODY = "synthetic alpha record";
let harness: SyntheticHarness;

beforeEach(async () => {
  harness = await createHarness(SYNTHETIC_ALPHA_SCENARIO);
});

afterEach(async () => {
  const report = await harness.stop();
  expect(report.listenerClosed).toBe(true);
  expect(report.socketsClosed).toBe(true);
  expect(report.registryReleased).toBe(true);
});

function at(type: string, op?: string): number {
  const index = harness
    .trace()
    .findIndex((event) => event.type === type && (op === undefined || event.op === op));
  expect(index, `${type}${op ? ` for ${op}` : ""} must be traced`).toBeGreaterThanOrEqual(0);
  return index;
}

function count(type: string, op?: string, detail?: string): number {
  return harness
    .trace()
    .filter(
      (event) =>
        event.type === type &&
        (op === undefined || event.op === op) &&
        (detail === undefined || event.detail === detail),
    ).length;
}

/** Start an HTTP case and hold the alpha gate at its store barrier. */
async function holdAlphaGate() {
  const holder = harness.request("alpha-read");
  expect(await holder.queued).toBe(true);
  await harness.barriers.reached(holder.id, "store");
  expect(harness.status().domains.alpha.active).toBe(holder.id);
  return holder;
}

describe("effect wins: the effect holds the gate, the revoker queues behind it", () => {
  it("hands off and finishes the HTTP release before the revocation commits", async () => {
    const holder = await holdAlphaGate();
    const revoker = harness.revoke("alpha");
    await harness.waitForTrace("revoke.queued", revoker.id);
    harness.barriers.open(holder.id, "store");

    const received = await holder.response;
    expect((await revoker.outcome).decision).toBe("admitted");
    expect(received).toMatchObject({ status: 200, body: BODY, complete: true, error: null });
    expect(at("revoke.queued", revoker.id)).toBeLessThan(at("http.handoff", holder.id));
    expect(at("http.handoff", holder.id)).toBeLessThan(at("http.finish", holder.id));
    expect(at("http.finish", holder.id)).toBeLessThan(at("revoke.commit", revoker.id));
    expect(harness.operation(holder.id).transport).toEqual({
      handoffAttempted: true,
      finishObserved: true,
      terminalFailure: false,
      clientReceived: true,
    });

    // The commit is real authority state: new work now gets the fixed denial over the wire.
    const later = harness.request("alpha-read-open");
    expect(await later.response).toMatchObject({ status: 404, body: "not found" });
    expect(count("permit.minted", later.id, "http-release")).toBe(0);
    expect(harness.status().domains.alpha).toMatchObject({ generation: 2, revoked: true });
  });

  it("admits the provider start before the revocation commits; completion starts nothing", async () => {
    const provider = harness.runSyntheticProvider("alpha-provider");
    await harness.barriers.reached(provider.id, "store");
    const revoker = harness.revoke("alpha");
    await harness.waitForTrace("revoke.queued", revoker.id);
    harness.barriers.open(provider.id, "store");

    expect((await provider.outcome).decision).toBe("admitted");
    expect((await revoker.outcome).decision).toBe("admitted");
    expect(at("provider.admitted", provider.id)).toBeLessThan(at("revoke.commit", revoker.id));
    expect(harness.status().jobs).toEqual([
      {
        opId: provider.id,
        domain: "alpha",
        caseId: "alpha-provider",
        generation: 1,
        job: "synthetic alpha job",
      },
    ]);

    harness.barriers.open(provider.id, "completion");
    expect(await provider.completion).toBe("ok");
    expect(at("revoke.commit", revoker.id)).toBeLessThan(at("provider.completed", provider.id));
    expect(count("provider.admitted")).toBe(1);
    expect(count("permit.minted", provider.id)).toBe(1);
    expect(harness.status().jobs).toHaveLength(1);
  });
});

describe("revoker wins: work queued behind the revoker is denied after the commit", () => {
  it("denies an old-generation request queued behind the revoker without resolving it", async () => {
    const holder = await holdAlphaGate();
    const revoker = harness.revoke("alpha");
    await harness.waitForTrace("revoke.queued", revoker.id);
    const stale = harness.request("alpha-read-open");
    expect(await stale.queued).toBe(true);
    expect(harness.operation(stale.id).expectedGeneration).toBe(1);
    harness.barriers.open(holder.id, "store");

    const received = await stale.response;
    expect(received).toMatchObject({ status: 404, body: "not found", complete: true });
    expect(received.body).not.toContain(BODY);
    expect(await holder.response).toMatchObject({ status: 200, body: BODY });
    expect(at("revoke.commit", revoker.id)).toBeLessThan(at("op.held", stale.id));
    expect(count("store.resolving", stale.id)).toBe(0);
    expect(count("permit.minted", stale.id, "http-release")).toBe(0);
    expect(await stale.outcome).toMatchObject({ decision: "denied", reason: "revoked-or-stale" });
  });

  it("is FIFO: queued work before the revoker runs, nothing overtakes the queued revoker", async () => {
    const holder = await holdAlphaGate();
    const first = harness.request("alpha-read-open");
    await first.queued;
    const second = harness.request("alpha-read-open");
    await second.queued;
    const revoker = harness.revoke("alpha");
    const after = harness.request("alpha-read-open");
    await after.queued;
    harness.barriers.open(holder.id, "store");

    expect(await first.response).toMatchObject({ status: 200, body: BODY });
    expect(await second.response).toMatchObject({ status: 200, body: BODY });
    expect(await after.response).toMatchObject({ status: 404, body: "not found" });
    const held = [holder, first, second, revoker, after].map(({ id }) => at("op.held", id));
    expect(held).toEqual([...held].sort((a, b) => a - b));
    expect(at("http.finish", second.id)).toBeLessThan(at("revoke.commit", revoker.id));
  });

  it("keeps independent domains independent", async () => {
    const holder = await holdAlphaGate();
    const revoker = harness.revoke("alpha");
    const beta = harness.request("beta-read");
    expect(await beta.response).toMatchObject({ status: 200, body: "synthetic beta record" });
    expect(harness.status().domains.alpha.active).toBe(holder.id);
    harness.barriers.open(holder.id, "store");
    await revoker.outcome;
    expect(harness.status().domains.beta).toMatchObject({ generation: 1, revoked: false });
    expect(await harness.request("beta-read").response).toMatchObject({ status: 200 });
  });
});

describe("store and provider errors before and after the start", () => {
  it("answers a store denial with the fixed 404 and releases the gate", async () => {
    const denied = harness.request("alpha-read-store-deny");
    expect(await denied.response).toMatchObject({ status: 404, body: "not found" });
    expect(await denied.outcome).toMatchObject({ decision: "denied", reason: "store-denied" });
    expect(count("permit.minted", denied.id, "http-release")).toBe(0);
    expect(await harness.request("alpha-read-open").response).toMatchObject({ status: 200 });
  });

  it("treats a definitive store rejection as a safe release with a fixed 503", async () => {
    const failing = harness.request("alpha-read-store-error");
    await harness.barriers.reached(failing.id, "store");
    const next = harness.request("alpha-read-open");
    await next.queued;
    harness.barriers.open(failing.id, "store");
    expect(await failing.response).toMatchObject({ status: 503, body: "unavailable" });
    expect(await failing.outcome).toMatchObject({ decision: "denied", reason: "store-error" });
    expect(await next.response).toMatchObject({ status: 200, body: BODY });
  });

  it("never starts a provider whose store resolution failed", async () => {
    const provider = harness.runSyntheticProvider("alpha-provider-store-error");
    expect(await provider.outcome).toMatchObject({ decision: "denied", reason: "store-error" });
    expect(await provider.completion).toBe("not-started");
    expect(harness.status().jobs).toEqual([]);
    expect(count("permit.minted", provider.id)).toBe(0);
  });

  it("keeps the start of a provider job that fails after admission, without retry", async () => {
    const provider = harness.runSyntheticProvider("alpha-provider-fails");
    expect((await provider.outcome).decision).toBe("admitted");
    // The gate was released at admission: other work proceeds while completion is pending.
    expect(await harness.request("alpha-read-open").response).toMatchObject({ status: 200 });
    harness.barriers.open(provider.id, "completion");
    expect(await provider.completion).toBe("error");
    expect(at("provider.admitted", provider.id)).toBeLessThan(at("provider.failed", provider.id));
    expect(harness.status().jobs.map((job) => job.opId)).toEqual([provider.id]);
    expect(count("provider.admitted")).toBe(1);
  });
});

describe("HTTP transport failures at the effect boundary", () => {
  it("classifies a throw after end as a partial hand-off: poison, no retry", async () => {
    const holder = await holdAlphaGate();
    const throwing = harness.request("alpha-read-end-throws");
    await throwing.queued;
    const revoker = harness.revoke("alpha");
    harness.barriers.open(holder.id, "store");

    await harness.waitForTrace("owner.poisoned");
    await Promise.all([holder.response, throwing.response]);
    // The holder's release finished (handed to the OS) before the poison. Whether its client read
    // the bytes before the poisoned owner destroyed its sockets is not asserted: finish is not
    // receipt, and the fixture never claims receipt from finish.
    expect(harness.operation(holder.id)).toMatchObject({
      decision: "admitted",
      transport: { handoffAttempted: true, finishObserved: true },
    });
    expect(at("http.finish", holder.id)).toBeLessThan(at("owner.poisoned"));
    expect(count("http.handoff", throwing.id)).toBe(1);
    expect(count("http.handoff.threw", throwing.id)).toBe(1);
    expect(harness.operation(throwing.id).transport).toMatchObject({
      handoffAttempted: true,
      terminalFailure: true,
    });
    expect(await revoker.outcome).toMatchObject({ decision: "invalidated" });
    expect(count("revoke.commit")).toBe(0);
    expect(harness.status()).toMatchObject({
      state: "poisoned",
      domains: { alpha: { generation: 1, active: throwing.id } },
    });
    expect(() => harness.request("alpha-read-open")).toThrow(/poisoned/u);
  });

  it("classifies a socket lost during hand-off as terminal, not finished", async () => {
    const lost = harness.request("alpha-read-socket-destroyed");
    const received = await lost.response;
    await harness.waitForTrace("owner.poisoned");
    expect(received).toMatchObject({ status: null, complete: false });
    expect(received.error).not.toBeNull();
    expect(harness.operation(lost.id).transport).toEqual({
      handoffAttempted: true,
      finishObserved: false,
      terminalFailure: true,
      clientReceived: false,
    });
    expect(count("http.finish", lost.id)).toBe(0);
    expect(harness.status().state).toBe("poisoned");
  });
});

describe("cancellation", () => {
  it("prevents admission of a queued operation", async () => {
    const holder = await holdAlphaGate();
    const queued = harness.request("alpha-read-open");
    await queued.queued;
    expect(queued.cancel()).toBe(true);
    harness.barriers.open(holder.id, "store");
    expect(await queued.response).toMatchObject({ status: 503, body: "unavailable" });
    expect(await queued.outcome).toMatchObject({ decision: "denied", reason: "cancelled" });
    expect(count("store.resolving", queued.id)).toBe(0);
    expect(count("permit.minted", queued.id, "http-release")).toBe(0);
  });

  it("keeps the gate held for an unresolved cancelled operation; the late resolution cannot resurrect it", async () => {
    const holder = await holdAlphaGate();
    const next = harness.request("alpha-read-open");
    await next.queued;
    expect(holder.cancel()).toBe(true);
    // Cancellation is not an unlock: the inert resolution is still outstanding.
    expect(harness.status().domains.alpha).toMatchObject({ active: holder.id, queued: 1 });
    expect(count("op.held", next.id)).toBe(0);
    harness.barriers.open(holder.id, "store");
    expect(await holder.response).toMatchObject({ status: 503, body: "unavailable" });
    expect(await next.response).toMatchObject({ status: 200, body: BODY });
    expect(at("store.resolved", holder.id)).toBeLessThan(at("op.held", next.id));
    expect(count("permit.minted", holder.id, "http-release")).toBe(0);
  });

  it("invalidates the permit of an operation cancelled just before the boundary", async () => {
    const op = harness.request("alpha-read-preboundary");
    await harness.barriers.reached(op.id, "pre-boundary");
    expect(op.cancel()).toBe(true);
    harness.barriers.open(op.id, "pre-boundary");
    expect(await op.response).toMatchObject({ status: 503, body: "unavailable" });
    expect(count("permit.minted", op.id, "http-release")).toBe(0);
  });

  it("does not recall an effect already handed off or started", async () => {
    const released = harness.request("alpha-read-open");
    expect(await released.response).toMatchObject({ status: 200 });
    expect(released.cancel()).toBe(false);
    const provider = harness.runSyntheticProvider("alpha-provider-fails");
    expect((await provider.outcome).decision).toBe("admitted");
    expect(provider.cancel()).toBe(false);
    expect(count("op.cancel.ignored")).toBe(2);
    expect(harness.status().jobs).toHaveLength(1);
    harness.barriers.open(provider.id, "completion");
    await provider.completion;
  });
});

describe("connection loss poisons the owner instead of releasing the gate", () => {
  it("leaves the queued revoker uncommitted and the late callback without effect", async () => {
    const holder = await holdAlphaGate();
    const revoker = harness.revoke("alpha");
    await harness.waitForTrace("revoke.queued", revoker.id);
    const queued = harness.request("alpha-read-open");
    await queued.queued;

    holder.abortTransport();
    await harness.waitForTrace("owner.poisoned");
    expect(harness.status()).toMatchObject({
      state: "poisoned",
      domains: { alpha: { active: holder.id, queued: 2, generation: 1 } },
    });
    expect(await revoker.outcome).toMatchObject({ decision: "invalidated" });
    expect(await queued.outcome).toMatchObject({ decision: "invalidated" });
    expect(() => harness.request("alpha-read-open")).toThrow(/poisoned/u);
    expect(() => harness.revoke("alpha")).toThrow(/poisoned/u);
    expect(() => harness.runSyntheticProvider("alpha-provider")).toThrow(/poisoned/u);

    harness.barriers.open(holder.id, "store");
    await harness.waitForTrace("late-resolution.ignored", holder.id);
    expect(await queued.response).toMatchObject({ status: null, complete: false });
    expect(count("permit.minted")).toBe(0);
    expect(count("http.handoff")).toBe(0);
    expect(count("revoke.commit")).toBe(0);
    expect(harness.status().domains.alpha.generation).toBe(1);
  });
});

describe("public API reentrancy and the sole-owner registry", () => {
  it("rejects same- and cross-domain public calls from owner context immediately", async () => {
    const before = harness.trace().length;
    const calls: (() => unknown)[] = [
      () => harness.request("alpha-read-open"),
      () => harness.request("beta-read"),
      () => harness.revoke("alpha"),
      () => harness.revoke("beta"),
      () => harness.runSyntheticProvider("alpha-provider"),
      () => harness.stop(),
    ];
    for (const call of calls) {
      expect(() => simulateOwnerContextForTesting(call)).toThrow(/reentrant/u);
    }
    await expect(
      simulateOwnerContextForTesting(() => createHarness(SYNTHETIC_ALPHA_SCENARIO)),
    ).rejects.toThrow(/reentrant/u);
    const added = harness.trace().slice(before);
    expect(added.map((event) => event.type)).toEqual(Array(6).fill("reentry.rejected"));
    // The refusals left the owner running and usable.
    expect(await harness.request("alpha-read-open").response).toMatchObject({ status: 200 });
  });

  it("rejects state-changing handle calls from owner context before any effect", async () => {
    const holder = await holdAlphaGate();
    const provider = harness.runSyntheticProvider("alpha-provider");
    await harness.waitForTrace("op.queued", provider.id);
    const before = harness.trace().length;
    const calls: [string, () => unknown][] = [
      ["abortTransport", () => holder.abortTransport()],
      ["cancel", () => holder.cancel()],
      ["cancel", () => provider.cancel()],
      ["barrier.open", () => harness.barriers.open(holder.id, "store")],
    ];
    for (const [method, call] of calls) {
      expect(() => simulateOwnerContextForTesting(call)).toThrow(`reentrant ${method} rejected`);
    }
    const added = harness.trace().slice(before);
    expect(added.map((event) => event.type)).toEqual(Array(calls.length).fill("reentry.rejected"));
    // Nothing was destroyed, withdrawn or opened: the holder still owns a live transport.
    expect(harness.status()).toMatchObject({
      state: "running",
      domains: { alpha: { active: holder.id, queued: 1 } },
    });
    expect(harness.operation(holder.id)).toMatchObject({
      cancelRequested: false,
      transportLost: false,
    });
    expect(harness.operation(provider.id)).toMatchObject({ cancelRequested: false });

    harness.barriers.open(holder.id, "store");
    expect(await holder.response).toMatchObject({ status: 200, body: BODY, complete: true });
    expect(count("owner.poisoned")).toBe(0);
    expect(count("transport.lost")).toBe(0);
  });

  it("refuses a second owner while one is live or poisoned; a verified stop releases it", async () => {
    await expect(createHarness(SYNTHETIC_ALPHA_SCENARIO)).rejects.toThrow(/already registered/u);
    await harness.request("alpha-read-socket-destroyed").response;
    await harness.waitForTrace("owner.poisoned");
    await expect(createHarness(SYNTHETIC_ALPHA_SCENARIO)).rejects.toThrow(/already registered/u);

    const report = await harness.stop();
    expect(report).toMatchObject({ priorState: "poisoned", registryReleased: true });
    expect(await harness.stop()).toBe(report);
    expect(() => harness.request("alpha-read-open")).toThrow(/stopped/u);

    const next = await createHarness(SYNTHETIC_ALPHA_SCENARIO);
    expect(await next.request("alpha-read-open").response).toMatchObject({ status: 200 });
    expect(await next.stop()).toMatchObject({ registryReleased: true });
  });

  it("rejects unknown cases, wrong-kind cases and cross-domain targets", () => {
    expect(() => harness.request("alpha-provider")).toThrow(/unknown fixture case/u);
    expect(() => harness.runSyntheticProvider("alpha-read")).toThrow(/unknown fixture case/u);
    expect(() => harness.request("http://127.0.0.1/op")).toThrow(/unknown fixture case/u);
    expect(() => harness.request("__proto__")).toThrow(/unknown fixture case/u);
    expect(() => harness.revoke("gamma" as "alpha")).toThrow(/unknown synthetic domain/u);
    expect(count("op.created")).toBe(0);
  });
});

describe("real loopback transport and teardown", () => {
  it("delivers fixed finite bytes with private, non-reusable headers to the real client", async () => {
    expect(harness.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    const op = harness.request("alpha-read-open");
    const received = await op.response;
    expect(received).toMatchObject({ status: 200, body: BODY, complete: true, error: null });
    expect(received.bytes).toBe(Buffer.byteLength(BODY));
    expect(received.headers).toMatchObject({
      "cache-control": FIXTURE_CACHE_CONTROL,
      vary: "Cookie",
      "content-length": String(Buffer.byteLength(BODY)),
      "content-type": "text/plain; charset=utf-8",
    });
    for (const header of ["etag", "last-modified", "date", "location", "transfer-encoding"]) {
      expect(received.headers[header], header).toBeUndefined();
    }
    expect(harness.operation(op.id)).toMatchObject({
      phase: "settled",
      decision: "admitted",
      transport: { handoffAttempted: true, finishObserved: true, clientReceived: true },
    });
  });

  it("answers foreign requests with a fixed 404 that touches no domain", async () => {
    const before = harness.status();
    for (const path of ["/", `/op/${"0".repeat(32)}`, "/op/../alpha"]) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        get({ host: LOOPBACK_HOST, port: Number(new URL(harness.origin).port), path }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        }).on("error", reject);
      });
      expect(status).toBe(404);
    }
    expect(count("http.unrouted")).toBe(3);
    expect(count("op.created")).toBe(0);
    expect(harness.status()).toEqual(before);
  });

  it("stops with the listener and sockets closed and no retained callback effect", async () => {
    const holder = await holdAlphaGate();
    const port = Number(new URL(harness.origin).port);
    const report = await harness.stop();
    expect(report).toMatchObject({
      priorState: "running",
      listenerClosed: true,
      socketsClosed: true,
      registryReleased: true,
    });
    expect(report.outstanding.map((op) => op.id)).toEqual([holder.id]);
    expect(report.outstanding[0]!.transport).toMatchObject({ handoffAttempted: false });

    const refused = await new Promise<string | undefined>((resolve) => {
      const socket = connect({ host: LOOPBACK_HOST, port });
      socket.on("connect", () => {
        socket.destroy();
        resolve("connected");
      });
      socket.on("error", (error: NodeJS.ErrnoException) => resolve(error.code));
    });
    expect(refused).toBe("ECONNREFUSED");

    harness.barriers.open(holder.id, "store");
    await harness.waitForTrace("late-resolution.ignored", holder.id);
    expect(await holder.outcome).toMatchObject({ decision: "invalidated" });
    expect(count("permit.minted")).toBe(0);
    expect(count("http.handoff")).toBe(0);
  });
});
