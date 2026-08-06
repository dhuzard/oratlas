# Database retry policy matrix

This matrix records the retry behavior that the architecture refactor preserves. The shared executor
in `apps/web/src/lib/db-retry.ts` owns only the attempt loop. Each use case still owns its retryable
codes and terminal error translation.

| Policy / owners                                                                      | Attempts | Retryable failures                                                                                  | Delay                | Terminal behavior                                                                           | Transaction options                            |
| ------------------------------------------------------------------------------------ | -------: | --------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Shared SQLite contention (`submission-*`, `editorial-lifecycle`, `claim-monitoring`) |        4 | `P1008`, `P2034`, or a `database is locked` / `SQLITE_BUSY` message; domain errors stop immediately | 25 ms, 50 ms, 100 ms | Original error                                                                              | Serializable; max wait 5 s; timeout 15 s       |
| Synthesis editorial and generation                                                   |        3 | Coded `P1008`, `P2002`, `P2028`, `P2034` failures                                                   | None                 | Exhausted retry codes become `SynthesisEditorialError(conflict)`; other errors pass through | Serializable; Prisma defaults for wait/timeout |
| Synthesis staleness and regeneration proposals                                       |        3 | Prisma `KnownRequestError` with `P2002` or `P2034` only                                             | None                 | Original error                                                                              | Serializable; Prisma defaults for wait/timeout |
| Challenge creation                                                                   |        3 | `P1008`, `P2028`, `P2034`; `P2002` is handled by challenge-specific active-key reconciliation       | None                 | Challenge-specific conflict/rate-limit mapping                                              | Serializable; max wait 5 s; timeout 15 s       |

The challenge policy is intentionally not routed through the common executor: its `P2002` path
performs domain reconciliation between attempts. Other one-shot transactions and context-specific
conflict handlers likewise remain local until their behavior is proven equivalent.
