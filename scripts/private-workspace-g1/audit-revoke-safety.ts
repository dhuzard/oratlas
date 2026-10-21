import { nativeEvidenceProblems } from "./native-evidence-safety.js";
/** Shared bounded JSON/Unicode/body decoder; never rewrites native evidence. */
export const auditRevokeDisclosureProblems = nativeEvidenceProblems;
/** Native cookie payload and signature are capabilities; public user id/time separately are not. */
export function auditRevokeCookieSecrets(header: string): string[] {
  const prefix = "oratlas_session=";
  if (!header.startsWith(prefix)) throw Error("Unexpected audit revocation cookie layout");
  const value = header.slice(prefix.length);
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1)
    throw Error("Unexpected audit revocation cookie layout");
  return [header, value, value.slice(0, separator), value.slice(separator + 1)];
}
