/** Separate bounded clock-observation helper; never used by strict G1 acceptance or a handler. */
export function nativeClockUpdateProblems(input: {
  beforeUpdatedAt: string;
  afterUpdatedAt: string;
  beforeEpochMs: number;
  afterEpochMs: number;
  skewBudgetMs: number;
}): string[] {
  const { beforeEpochMs, afterEpochMs, skewBudgetMs } = input;
  if (
    ![beforeEpochMs, afterEpochMs, skewBudgetMs].every(Number.isFinite) ||
    beforeEpochMs > afterEpochMs ||
    skewBudgetMs < 0 ||
    skewBudgetMs > 1000
  )
    return ["Invalid bounded observation window or explicit clock-skew budget"];
  const previous = Date.parse(input.beforeUpdatedAt);
  const current = Date.parse(input.afterUpdatedAt);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return ["Invalid native timestamp"];
  const problems: string[] = [];
  if (current <= previous) problems.push("Native timestamp did not advance from fixture");
  if (current < beforeEpochMs - skewBudgetMs || current > afterEpochMs + skewBudgetMs)
    problems.push("Native timestamp outside observed real-clock window");
  return problems;
}
