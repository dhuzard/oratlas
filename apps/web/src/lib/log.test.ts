import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetServerEnvCache } from "@oratlas/config";
import { createLogger, logger, serializeError } from "@/lib/log";

// Provide a secret so @oratlas/config does not emit its own console warning
// (and does not throw when we exercise the production branch below).
vi.stubEnv("SESSION_SECRET", "test-session-secret");

function setNodeEnv(value: "development" | "test" | "production"): void {
  vi.stubEnv("NODE_ENV", value);
  resetServerEnvCache();
}

afterAll(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  resetServerEnvCache();
});

describe("serializeError", () => {
  it("returns { name, message } and never a stack", () => {
    const err = new TypeError("boom");
    const out = serializeError(err);
    expect(out).toEqual({ name: "TypeError", message: "boom" });
    expect(out).not.toHaveProperty("stack");
  });

  it("handles non-Error values", () => {
    expect(serializeError("nope")).toEqual({ name: "Error", message: "nope" });
  });
});

describe("logger output shape", () => {
  beforeEach(() => {
    setNodeEnv("development");
  });

  it("emits a single JSON line with level, msg, time, fields and bindings", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const bound = createLogger({ requestId: "req-1" });

    bound.info("hello", { userId: 42 });

    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(parsed).toMatchObject({
      level: "info",
      msg: "hello",
      requestId: "req-1",
      userId: 42,
    });
    expect(typeof parsed.time).toBe("string");
    expect(new Date(parsed.time).toISOString()).toBe(parsed.time);
  });

  it("serializes Error-valued fields without a stack", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.error("failed", { error: new RangeError("out of range") });

    const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(parsed.error).toEqual({ name: "RangeError", message: "out of range" });
    expect(parsed.error).not.toHaveProperty("stack");
  });

  it("routes warn to console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("careful");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0]![0] as string).level).toBe("warn");
  });
});

describe("environment behavior", () => {
  it("suppresses all output when NODE_ENV === test", () => {
    setNodeEnv("test");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.debug("d");

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("suppresses debug in production but keeps info", () => {
    setNodeEnv("production");
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    logger.debug("hidden");
    expect(spy).not.toHaveBeenCalled();

    logger.info("shown");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
