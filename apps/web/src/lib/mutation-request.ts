/** Exact request-integrity checks for cookie-authenticated JSON mutations. */
export function validateSameOriginJsonRequest(
  request: Request,
  configuredBaseUrl: string,
): { ok: true } | { ok: false; status: 403 | 415; message: string } {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, status: 415, message: "Content-Type application/json is required." };
  }

  const origin = request.headers.get("origin");
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(configuredBaseUrl).origin;
  } catch {
    return { ok: false, status: 403, message: "The application origin is not configured." };
  }
  if (!origin || origin !== expectedOrigin) {
    return { ok: false, status: 403, message: "A matching same-origin request is required." };
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return { ok: false, status: 403, message: "Cross-site mutation requests are refused." };
  }
  return { ok: true };
}
