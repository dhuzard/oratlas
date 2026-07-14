import "server-only";
import { getServerEnv } from "@oratlas/config";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/** Serialize an Error to a leak-safe shape. Never includes the stack. */
export function serializeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { name: "Error", message: String(err) };
}

/** Replace Error-valued fields with their leak-safe serialization. */
function normalizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? serializeError(value) : value;
  }
  return out;
}

/** Lowest level that should be emitted for the current environment. */
function thresholdFor(nodeEnv: string): number {
  // Production hides debug; other environments emit everything.
  return nodeEnv === "production" ? LEVEL_ORDER.info : LEVEL_ORDER.debug;
}

function emit(
  level: LogLevel,
  bindings: Record<string, unknown>,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  const { NODE_ENV } = getServerEnv();
  // Keep the test suite quiet.
  if (NODE_ENV === "test") return;
  if (LEVEL_ORDER[level] < thresholdFor(NODE_ENV)) return;

  const line = JSON.stringify({
    level,
    msg,
    time: new Date().toISOString(),
    ...normalizeFields(bindings),
    ...(fields ? normalizeFields(fields) : {}),
  });

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    // debug/info route through console.info (repo lint allows warn/error/info).
    console.info(line);
  }
}

/** Create a logger whose every line carries the given bindings. */
export function createLogger(bindings: Record<string, unknown>): Logger {
  return {
    debug: (msg, fields) => emit("debug", bindings, msg, fields),
    info: (msg, fields) => emit("info", bindings, msg, fields),
    warn: (msg, fields) => emit("warn", bindings, msg, fields),
    error: (msg, fields) => emit("error", bindings, msg, fields),
  };
}

export const logger: Logger = createLogger({});
