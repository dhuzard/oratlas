# Health, readiness & logs

How to probe the app, read its logs, and reason about its request-level protections.

See also: [postgres.md](./postgres.md), [backup-recovery.md](./backup-recovery.md), and the
[operations index](./README.md).

## Health vs readiness

Two distinct endpoints — do not conflate them:

- **Liveness** — `GET /api/health` → `{status:"ok"}`. No dependencies, always fast. Answers
  "is the process up?". Use it for process/liveness probes and restart decisions.
- **Readiness** — `GET /api/health/ready` → 200 `{status:"ready",checks:{database:"ok"}}` when
  the database round-trips, otherwise 503 `{status:"unavailable"}`. Answers "can this instance
  serve traffic right now?".

**Point the load balancer / uptime check at `/api/health/ready`.** A failing dependency then
takes an instance out of rotation instead of serving errors, while liveness keeps the process
from being needlessly restarted.

## Structured logs

Logs are emitted as single-line JSON via `apps/web/src/lib/log.ts`
(`logger.info` / `logger.warn` / `logger.error`). Each request carries a correlation id: an
incoming `x-request-id` header is honored, otherwise a fresh id is generated
(`apps/web/src/lib/request-context.ts`), and it is bound to every log line for that request.

Example line:

```json
{
  "level": "info",
  "msg": "request completed",
  "time": "2026-07-14T12:00:00.000Z",
  "requestId": "a1b2c3d4-...",
  "status": 200
}
```

**Stack traces are never serialized** — not to logs and not to responses. Errors are reduced to
a leak-safe `{name, message}` shape before logging.

## Rate limiting

A per-identity fixed-window limiter (`apps/web/src/lib/rate-limit.ts`) protects mutating
routes. Tune it with:

- `RATE_LIMIT_MAX` — requests allowed per window.
- `RATE_LIMIT_WINDOW_MS` — window length in milliseconds.

The limiter is in-process for the POC. The production swap is a shared store (e.g. Redis) so a
single budget spans all instances.

## Request body cap

JSON request bodies are capped at ~256 KiB. Oversized requests are rejected with HTTP 413
`payload-too-large` before the handler runs.

## Ingestion queue

Ingestion runs behind an `IngestionRunner` interface backed by an in-process async job queue:
`enqueue` returns a job handle. It is in-process for the POC; the production swap is a
broker/worker (e.g. Redis/BullMQ) behind the same interface, so callers do not change. Watch
the logs (correlated by request id) to trace an enqueued job.
