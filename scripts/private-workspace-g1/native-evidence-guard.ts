import { captureHttp } from "./capture.js";
import {
  cookieHeader,
  validSession,
  PRINCIPAL_LABELS,
  NEGATIVE_SESSIONS,
  type SessionRecipe,
  type SessionSigner,
} from "./principals.js";
import { nativeEvidenceProblems } from "./native-evidence-safety.js";

/** Synthetic child-only guard; explicit signer and URL, no global/engine changes or output rewriting. */
export function createNativeEvidenceGuard(
  sign: SessionSigner,
  databaseUrl: string,
  sessions: readonly SessionRecipe[] = [],
) {
  const secrets = new Set<string>();
  function cookie(header: string | null | undefined): void {
    if (!header) return;
    secrets.add(header);
    const value = header.slice(header.indexOf("=") + 1),
      separator = value.lastIndexOf(".");
    // The public malformed recipe is not a signed credential. Its full header is still guarded.
    if (separator > 0 && separator < value.length - 1)
      for (const part of [value, value.slice(0, separator), value.slice(separator + 1)])
        secrets.add(part);
  }
  try {
    const url = new URL(databaseUrl);
    for (const part of [databaseUrl, url.password, decodeURIComponent(url.password)])
      if (part) secrets.add(part);
    for (const recipe of [
      ...PRINCIPAL_LABELS.filter((p) => p !== "anonymous").map((p) => validSession(p)),
      ...NEGATIVE_SESSIONS,
      ...sessions,
    ])
      cookie(cookieHeader(recipe, sign));
  } catch {
    throw new Error("Native evidence guard initialization refused");
  }
  function value<T>(input: T): T {
    if (nativeEvidenceProblems(input, [...secrets], "capture").length)
      throw new Error("Native evidence capability disclosure refused");
    return input;
  }
  async function capture(...args: Parameters<typeof captureHttp>) {
    cookie(args[2]?.get("cookie"));
    let record: Awaited<ReturnType<typeof captureHttp>>;
    try {
      record = await captureHttp(...args);
    } catch {
      throw new Error("Native evidence capture observation refused");
    }
    return value(record);
  }
  async function response(input: Response): Promise<Response> {
    let body: string;
    try {
      body = await input.clone().text();
    } catch {
      throw new Error("Native evidence response observation refused");
    }
    value({ headers: [...input.headers], body });
    return input;
  }
  return { cookie, value, capture, response };
}
export type NativeEvidenceGuard = ReturnType<typeof createNativeEvidenceGuard>;
