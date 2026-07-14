import "server-only";
import { randomUUID } from "node:crypto";
import { createLogger, type Logger } from "@/lib/log";

/** Correlate a request: reuse an incoming x-request-id, else mint a fresh id. */
export function requestId(headers: Headers): string {
  const incoming = headers.get("x-request-id");
  if (incoming && incoming.trim() !== "") {
    return incoming;
  }
  return randomUUID();
}

/** A logger bound to the request's correlation id. */
export function requestLogger(headers: Headers): Logger {
  return createLogger({ requestId: requestId(headers) });
}
