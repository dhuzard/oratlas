import { workerOutputProblems } from "./worker-capture-safety.js";

/** Inspection only. Call before validators/assertions/logs/files; never rewrite native evidence. */
export function nativeEvidenceProblems(value: unknown, secrets: readonly string[]): string[] {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0,
    stringBytes = 0;
  const refusal = () => ["Native evidence capability disclosure refused"];
  while (pending.length) {
    const entry = pending.pop()!;
    if (++visited > 250_000 || entry.depth > 64)
      return ["Native evidence inspection bound refused"];
    if (typeof entry.value === "string") {
      const text = entry.value;
      stringBytes += Buffer.byteLength(text);
      if (Buffer.byteLength(text) > 16 * 1024 * 1024 || stringBytes > 64 * 1024 * 1024)
        return ["Native evidence inspection bound refused"];
      if (
        workerOutputProblems(text).length ||
        secrets.some(
          (secret) =>
            secret.length > 0 &&
            (text.includes(secret) || text.includes(JSON.stringify(secret).slice(1, -1))),
        )
      )
        return refusal();
      try {
        pending.push({ value: JSON.parse(text), depth: entry.depth + 1 });
      } catch {
        /* Ordinary text. */
      }
    } else if (entry.value && typeof entry.value === "object") {
      for (const [key, child] of Object.entries(entry.value)) {
        pending.push(
          { value: key, depth: entry.depth + 1 },
          { value: child, depth: entry.depth + 1 },
        );
        // Native HTTP capture representation. Inspect bytes as text without altering retained bytes.
        if (key === "bodyBase64" && typeof child === "string") {
          if (Buffer.byteLength(child) > 16 * 1024 * 1024)
            return ["Native evidence inspection bound refused"];
          pending.push({
            value: Buffer.from(child, "base64").toString("utf8"),
            depth: entry.depth + 1,
          });
        }
      }
    }
  }
  return [];
}
