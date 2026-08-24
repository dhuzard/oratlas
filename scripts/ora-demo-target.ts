/** Fail closed before a deterministic fixture can contact an unintended deployment. */
export function assertSafeOraDemoBaseUrl(rawBaseUrl: string, allowRemote: boolean): string {
  const invalidTargetMessage =
    "The ORA demo target must be an HTTP(S) origin without credentials or a path.";
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new Error(invalidTargetMessage);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(invalidTargetMessage);
  }

  const serializedHostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  const hostname =
    serializedHostname.startsWith("[") && serializedHostname.endsWith("]")
      ? serializedHostname.slice(1, -1)
      : serializedHostname;
  const local =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname) ||
    hostname === "0.0.0.0" ||
    hostname === "::" ||
    hostname === "::1";
  if (!local && !allowRemote) {
    throw new Error(
      "The deterministic ORA demo refuses remote targets. Set ORA_DEMO_ALLOW_REMOTE=1 only for an isolated remote demo deployment.",
    );
  }
  return url.origin;
}
