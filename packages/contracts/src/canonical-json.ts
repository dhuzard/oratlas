/**
 * Serialize JSON data deterministically. Object keys are sorted recursively;
 * unsupported or lossy values fail closed instead of being silently coerced.
 * The result is suitable for hashing immutable capture/submission payloads.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set<object>(), "$"));
}

function normalize(value: unknown, seen: Set<object>, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError(`Invalid date at ${path}.`);
    return value.toISOString();
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(`Unsupported JSON value at ${path}.`);
  }
  if (seen.has(value)) throw new TypeError(`Circular JSON value at ${path}.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => normalize(entry, seen, `${path}[${index}]`));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Non-plain object at ${path}.`);
    }
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      // JSON.stringify omits undefined object members. Do that explicitly so
      // the behavior is deliberate while arrays remain strict.
      if (input[key] === undefined) continue;
      output[key] = normalize(input[key], seen, `${path}.${key}`);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}
