import { workerOutputProblems } from "./worker-capture-safety.js";

/** Measured native capture+sidecar aggregates need more nodes; scalar byte/depth limits stay fixed. */
export const NATIVE_CAPTURE_ENTRY_LIMIT = 1_000_000;
/** Inspection only. Call before validators/assertions/logs/files; never rewrite native evidence. */
export function nativeEvidenceProblems(
  value: unknown,
  secrets: readonly string[],
  scope: "value" | "capture" = "value",
): string[] {
  if (scope !== "value" && scope !== "capture") return ["Native evidence inspection bound refused"];
  const entryLimit = scope === "capture" ? NATIVE_CAPTURE_ENTRY_LIMIT : 250_000;
  const representations = [
    ...new Set(
      secrets
        .filter((secret) => secret.length > 0)
        .flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]),
    ),
  ];
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0,
    stringBytes = 0,
    scheduled = 1;
  const bound = () => ["Native evidence inspection bound refused"];
  const schedule = (...entries: Array<{ value: unknown; depth: number }>) => {
    if (scheduled + entries.length > entryLimit || entries.some((entry) => entry.depth > 64))
      return false;
    scheduled += entries.length;
    pending.push(...entries);
    return true;
  };
  const refusal = () => ["Native evidence capability disclosure refused"];
  while (pending.length) {
    const entry = pending.pop()!;
    if (++visited > entryLimit || entry.depth > 64)
      return ["Native evidence inspection bound refused"];
    if (typeof entry.value === "string") {
      const text = entry.value;
      stringBytes += Buffer.byteLength(text);
      if (Buffer.byteLength(text) > 16 * 1024 * 1024 || stringBytes > 64 * 1024 * 1024)
        return ["Native evidence inspection bound refused"];
      if (
        workerOutputProblems(text).length ||
        representations.some((secret) => secret.length <= text.length && text.includes(secret))
      )
        return refusal();
      try {
        const parsed: unknown = JSON.parse(text);
        if (!schedule({ value: parsed, depth: entry.depth + 1 })) return bound();
      } catch {
        /* Ordinary text. */
      }
    } else if (entry.value && typeof entry.value === "object") {
      for (const [key, child] of Object.entries(entry.value)) {
        if (
          !schedule(
            { value: key, depth: entry.depth + 1 },
            { value: child, depth: entry.depth + 1 },
          )
        )
          return bound();
        // Native HTTP capture representation. Inspect bytes as text without altering retained bytes.
        if (key === "bodyBase64" && typeof child === "string") {
          if (Buffer.byteLength(child) > 16 * 1024 * 1024)
            return ["Native evidence inspection bound refused"];
          if (
            !schedule({
              value: Buffer.from(child, "base64").toString("utf8"),
              depth: entry.depth + 1,
            })
          )
            return bound();
        }
      }
    }
  }
  return [];
}

/** Inspect exact raw logs plus complete JSON lines; embedded non-JSON/ANSI fragments are not decoded. */
export function nativeLogEvidenceProblems(text: string, secrets: readonly string[]): string[] {
  const lines = text.split("\n", 4097);
  if (lines.length > 4096) return ["Native log evidence line bound refused"];
  return nativeEvidenceProblems([text, ...lines], secrets);
}
