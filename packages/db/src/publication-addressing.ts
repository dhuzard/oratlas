import { publicationHttpsUrlSchema } from "@oratlas/contracts";

export interface PublicationManifestAddress {
  artifactKind: string;
  observedUrl: string | null | undefined;
  requestedUrl: string | null | undefined;
}

/**
 * Derive the publication directory ORAtlas actually addressed while fetching
 * one manifest. The observed final URL wins; the requested URL is only the
 * fallback. Query and fragment components never become part of the base.
 */
export function deriveObservedPublicationBaseUrl(
  capture: Pick<PublicationManifestAddress, "observedUrl" | "requestedUrl">,
): string | null {
  const parsed = publicationHttpsUrlSchema.safeParse(capture.observedUrl ?? capture.requestedUrl);
  if (!parsed.success) return null;
  const base = new URL(".", parsed.data);
  base.search = "";
  base.hash = "";
  return publicationHttpsUrlSchema.parse(base.href);
}

/**
 * Resolve new rows from their retained derived value and pre-Phase-3 rows from
 * the first immutable manifest capture. Any disagreement fails closed.
 */
export function resolveObservedPublicationBaseUrl(input: {
  observedPublicationBaseUrl: string | null;
  captures: readonly PublicationManifestAddress[];
}): string | null {
  const manifest = input.captures.find(
    (capture) => capture.artifactKind === "publication-manifest",
  );
  const capturedBase = manifest ? deriveObservedPublicationBaseUrl(manifest) : null;
  const retained = publicationHttpsUrlSchema.safeParse(input.observedPublicationBaseUrl);
  if (input.observedPublicationBaseUrl !== null && !retained.success) return null;
  if (retained.success && capturedBase && retained.data !== capturedBase) return null;
  return retained.success ? retained.data : capturedBase;
}
