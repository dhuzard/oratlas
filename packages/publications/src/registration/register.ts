import {
  SUPPORTED_PUBLICATION_PROTOCOL_VERSIONS,
  isSafeRepoRelativePath,
  type PublicationRegistrationWarning,
  type PublicationSourceVerification,
  type PublicationStructuralProvenance,
  type PublicationType,
} from "@oratlas/contracts";
import {
  mystClaimRecordSchema,
  mystPublicationManifestSchema,
  normalizeMystPublication,
  PublicationAdapterError,
  type MystClaimRecord,
  type MystPublicationManifest,
  type NormalizedPublication,
} from "../adapters/myst.js";
import { PublicationIdentityError } from "../identity.js";
import { reachedStructuralProvenance } from "../structural-provenance.js";
import { JsonlParseError, parseJsonl } from "../protocol/jsonl.js";
import {
  observedSiteRoot,
  publicationSiteRoot,
  resolveArtifactUrl,
  resolvePublishedUrl,
} from "../protocol/resolve-url.js";
import {
  findXrefReference,
  isSafeInventoryPath,
  mystXrefInventorySchema,
  pageDataContainsIdentifier,
  type MystXrefInventory,
} from "../protocol/xref.js";
import {
  captureKeyFor,
  decodeUtf8Strict,
  sha256Bytes,
  type CapturedArtifact,
  type PublicationCaptureSet,
} from "./capture.js";
import { PublicationRegistrationError } from "./errors.js";
import {
  isUrlRefusal,
  provenanceOf,
  type FetchedArtifactBytes,
  type PublicationArtifactFetcher,
} from "./fetcher.js";
import {
  ARTIFACT_MEDIA_TYPES,
  DEFAULT_REGISTRATION_LIMITS,
  type RegistrationLimits,
} from "./limits.js";
import {
  SourceByteMismatchError,
  verifySourceBytes,
  type PublicationSourceDocumentResolver,
} from "./source-bytes.js";

/**
 * Registration of an externally hosted publication, end to end and
 * framework-free.
 *
 * ```
 * manifest URL → bounded safe retrieval → capture exact bytes + digests
 *              → fail-closed protocol validation
 *              → published-structure verification (published bytes only)
 *              → optional source-byte verification (exact source bytes)
 *              → normalized publication / version / source occurrences
 * ```
 *
 * Nothing here reaches the network directly, touches a database, executes a
 * MyST plugin, evaluates HTML or JavaScript, runs repository code, or shells
 * out. It reads bytes a transport handed it and refuses everything it cannot
 * account for.
 *
 * The output stops at source occurrences. Binding one to a canonical claim is
 * a separate, explicit, reviewed decision and is deliberately not performed.
 */

export interface PublishedClaimLocation {
  sourceLocalClaimId: string;
  /** Absolute published URL, resolved under the producer contract's rule. */
  publishedUrl: string;
  /** Page-data document the inventory pointed at, when it declared one. */
  pageDataPath?: string;
  /** Whether a node carrying the identifier was found in that page data. */
  pageDataVerified: boolean;
}

export interface RegisterPublicationInput {
  manifestUrl: string;
  /**
   * The 0.2.0 producer contract declares no publication type. ORAtlas does not
   * infer one from the artifacts; an operator states it, or it stays `other`
   * until an editor corrects it.
   */
  publicationType: PublicationType;
  fetcher: PublicationArtifactFetcher;
  /** Optional exact-byte source resolver. Absent means level 1 only. */
  sourceResolver?: PublicationSourceDocumentResolver;
  limits?: Partial<RegistrationLimits>;
  now?: () => Date;
  /**
   * Opaque ORAtlas-minted key, used only when the publication declares no
   * durable identity evidence of its own.
   */
  registrationKey?: string;
}

export interface PublicationObservation {
  capture: PublicationCaptureSet;
  manifest: MystPublicationManifest;
  claims: MystClaimRecord[];
  normalized: NormalizedPublication;
  publishedLocations: PublishedClaimLocation[];
  structuralProvenance: PublicationStructuralProvenance;
  sourceVerification: PublicationSourceVerification;
  warnings: PublicationRegistrationWarning[];
}

interface FetchBudget {
  remaining: number;
}

function warn(
  warnings: PublicationRegistrationWarning[],
  code: PublicationRegistrationWarning["code"],
  message: string,
): void {
  if (warnings.some((existing) => existing.code === code)) return;
  warnings.push({ code, message });
}

async function retrieve(
  fetcher: PublicationArtifactFetcher,
  url: string,
  allowedMediaTypes: readonly string[],
  maxResponseBytes: number,
  budget: FetchBudget,
  failureCode: "manifest-unreachable" | "artifact-unreachable",
): Promise<FetchedArtifactBytes> {
  if (budget.remaining <= 0) {
    throw new PublicationRegistrationError(
      "limit-exceeded",
      "The publication declares more artifacts than one registration will retrieve.",
    );
  }
  budget.remaining -= 1;
  try {
    return await fetcher.fetchArtifact(url, { allowedMediaTypes, maxResponseBytes });
  } catch (error) {
    if (failureCode === "manifest-unreachable" && isUrlRefusal(error)) {
      throw new PublicationRegistrationError(
        "manifest-url-rejected",
        "That URL is not an acceptable registration target.",
        messageOf(error),
      );
    }
    throw new PublicationRegistrationError(
      failureCode,
      failureCode === "manifest-unreachable"
        ? "The publication manifest could not be retrieved."
        : "A declared publication artifact could not be retrieved.",
      messageOf(error),
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Retrieval failed.";
}

function decodeArtifact(fetched: FetchedArtifactBytes, what: string): string {
  try {
    return decodeUtf8Strict(fetched.bytes);
  } catch {
    throw new PublicationRegistrationError(
      "artifact-malformed",
      `The publication's ${what} is not valid UTF-8.`,
    );
  }
}

function parseJsonArtifact(
  text: string,
  what: string,
  code: "manifest-invalid-json" | "artifact-malformed",
): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PublicationRegistrationError(code, `The publication's ${what} is not valid JSON.`);
  }
}

/**
 * Read the declared schema version and adapter type from the raw manifest,
 * before any structural parsing.
 *
 * Version and adapter are checked first and separately so that an unimplemented
 * manifest is refused as unimplemented rather than reported as malformed
 * against a schema that was never meant to apply to it. Partially interpreting
 * a future manifest is the thing this exists to prevent.
 */
function assertImplementedManifestShape(raw: unknown): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new PublicationRegistrationError(
      "manifest-invalid",
      "The publication manifest is not a JSON object.",
    );
  }
  const record = raw as Record<string, unknown>;
  const declared = record.schemaVersion;
  if (
    typeof declared !== "string" ||
    !(SUPPORTED_PUBLICATION_PROTOCOL_VERSIONS as readonly string[]).includes(declared)
  ) {
    throw new PublicationRegistrationError(
      "manifest-schema-unsupported",
      `ORAtlas implements publication manifest schema ${SUPPORTED_PUBLICATION_PROTOCOL_VERSIONS.join(", ")} and will not partially interpret another version.`,
      typeof declared === "string" ? `Declared schema version: ${declared}.` : undefined,
    );
  }
  const adapter = record.adapter;
  const adapterType =
    typeof adapter === "object" && adapter !== null
      ? (adapter as Record<string, unknown>).type
      : undefined;
  if (adapterType !== "myst") {
    throw new PublicationRegistrationError(
      "adapter-not-supported",
      "ORAtlas implements the 'myst' publication adapter and will not guess at another.",
    );
  }
}

/**
 * Re-validate every path the manifest declares before anything is resolved.
 *
 * The manifest schema also enforces this, but the check is repeated here, on
 * the raw document, so that an unsafe path is reported as an unsafe path and
 * so that no future refactor can arrive at a fetch without having passed one.
 */
function assertDeclaredPathsAreSafe(raw: unknown): void {
  const record = raw as Record<string, unknown>;
  const adapter = (record.adapter ?? {}) as Record<string, unknown>;
  const artifacts = (record.artifacts ?? {}) as Record<string, unknown>;
  const claims = (artifacts.claims ?? {}) as Record<string, unknown>;
  const oratlas = (record.oratlas ?? {}) as Record<string, unknown>;

  const declared: Array<[string, unknown]> = [
    ["adapter.xref", adapter.xref],
    ["artifacts.claims.path", claims.path],
  ];
  if (oratlas.reviewManifest !== undefined) {
    declared.push(["oratlas.reviewManifest", oratlas.reviewManifest]);
  }

  for (const [field, value] of declared) {
    if (value === undefined) continue;
    if (typeof value !== "string" || !isSafeRepoRelativePath(value)) {
      throw new PublicationRegistrationError(
        "artifact-path-unsafe",
        "The publication declares an artifact path ORAtlas will not resolve.",
        `Unsafe declared path at ${field}.`,
      );
    }
  }
}

export async function registerPublicationFromManifest(
  input: RegisterPublicationInput,
): Promise<PublicationObservation> {
  const limits: RegistrationLimits = { ...DEFAULT_REGISTRATION_LIMITS, ...input.limits };
  const now = input.now ?? (() => new Date());
  const warnings: PublicationRegistrationWarning[] = [];
  const budget: FetchBudget = { remaining: limits.maxArtifactFetches };
  const artifacts: CapturedArtifact[] = [];

  // 1. Retrieve and capture the manifest itself.
  const manifestFetch = await retrieve(
    input.fetcher,
    input.manifestUrl,
    ARTIFACT_MEDIA_TYPES.manifest,
    limits.maxManifestBytes,
    budget,
    "manifest-unreachable",
  );
  const manifestText = decodeArtifact(manifestFetch, "manifest");
  const manifestSha256 = sha256Bytes(manifestFetch.bytes);
  artifacts.push({
    kind: "publication-manifest",
    text: manifestText,
    sha256: manifestSha256,
    byteLength: manifestFetch.bytes.byteLength,
    mediaType: manifestFetch.mediaType,
    provenance: provenanceOf(manifestFetch),
  });

  // 2. Refuse an unimplemented contract before interpreting anything.
  const rawManifest = parseJsonArtifact(manifestText, "manifest", "manifest-invalid-json");
  assertImplementedManifestShape(rawManifest);
  assertDeclaredPathsAreSafe(rawManifest);

  const parsedManifest = mystPublicationManifestSchema.safeParse(rawManifest);
  if (!parsedManifest.success) {
    throw new PublicationRegistrationError(
      "manifest-invalid",
      "The publication manifest is not a valid document of the schema it declares.",
      parsedManifest.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join(" "),
    );
  }
  const manifest = parsedManifest.data;

  if (manifest.artifacts.claims.records > limits.maxClaimRecords) {
    throw new PublicationRegistrationError(
      "limit-exceeded",
      `The publication declares more than the ${limits.maxClaimRecords} claim records ORAtlas will read.`,
    );
  }

  // Artifacts are fetched relative to where the manifest was actually served,
  // never relative to the declared canonical URL: the producer contract forbids
  // dereferencing that URL as part of validation.
  const observedRoot = observedSiteRoot(manifestFetch.finalUrl);

  // 3. Retrieve, capture and digest-check the claim stream.
  const claimsUrl = resolveArtifactUrl(observedRoot, manifest.artifacts.claims.path);
  const claimsFetch = await retrieve(
    input.fetcher,
    claimsUrl,
    ARTIFACT_MEDIA_TYPES.claimStream,
    limits.maxClaimStreamBytes,
    budget,
    "artifact-unreachable",
  );
  const claimsText = decodeArtifact(claimsFetch, "claim stream");
  const claimsSha256 = sha256Bytes(claimsFetch.bytes);
  artifacts.push({
    kind: "claim-stream",
    declaredPath: manifest.artifacts.claims.path,
    text: claimsText,
    sha256: claimsSha256,
    byteLength: claimsFetch.bytes.byteLength,
    mediaType: claimsFetch.mediaType,
    declaredSha256: manifest.artifacts.claims.sha256,
    provenance: provenanceOf(claimsFetch),
  });
  if (claimsSha256 !== manifest.artifacts.claims.sha256) {
    throw new PublicationRegistrationError(
      "artifact-digest-mismatch",
      "The claim stream does not match the digest the publication declared for it.",
    );
  }

  let rawClaims: unknown[];
  try {
    rawClaims = parseJsonl(claimsText, { maxRecords: limits.maxClaimRecords });
  } catch (error) {
    if (error instanceof JsonlParseError) {
      throw new PublicationRegistrationError(
        "artifact-malformed",
        "The publication's claim stream is not well-formed JSON Lines.",
        error.line === undefined ? error.message : `${error.message} (record ${error.line})`,
      );
    }
    throw error;
  }
  if (rawClaims.length !== manifest.artifacts.claims.records) {
    throw new PublicationRegistrationError(
      "artifact-record-count-mismatch",
      "The claim stream carries a different number of records than the publication declared.",
    );
  }

  const claims: MystClaimRecord[] = [];
  const seenIds = new Set<string>();
  for (const [index, raw] of rawClaims.entries()) {
    const parsed = mystClaimRecordSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PublicationRegistrationError(
        "claim-record-invalid",
        "A claim record is not a valid record of the schema the publication declares.",
        `Record ${index + 1}: ${parsed.error.issues[0]?.message ?? "invalid"}.`,
      );
    }
    if (seenIds.has(parsed.data.id)) {
      throw new PublicationRegistrationError(
        "duplicate-source-local-claim-id",
        "The publication declares one source-local claim id more than once.",
        `Duplicate id: ${parsed.data.id}.`,
      );
    }
    seenIds.add(parsed.data.id);
    claims.push(parsed.data);
  }
  if (claims.length === 0) {
    warn(
      warnings,
      "publication-declares-no-claims",
      "The publication declares no claims, so no source occurrences were materialized.",
    );
  }

  // 4. Declaration authority. Two artifacts must never both own the same
  //    declarations, and ORAtlas never picks a winner heuristically.
  const reviewManifestArtifact = await captureReviewManifest({
    manifest,
    observedRoot,
    fetcher: input.fetcher,
    limits,
    budget,
    warnings,
  });
  if (reviewManifestArtifact !== undefined) artifacts.push(reviewManifestArtifact);

  // 5. Retrieve and capture the cross-reference inventory.
  const inventoryUrl = resolveArtifactUrl(observedRoot, manifest.adapter.xref);
  const inventoryFetch = await retrieve(
    input.fetcher,
    inventoryUrl,
    ARTIFACT_MEDIA_TYPES.inventory,
    limits.maxInventoryBytes,
    budget,
    "artifact-unreachable",
  );
  const inventoryText = decodeArtifact(inventoryFetch, "cross-reference inventory");
  artifacts.push({
    kind: "cross-reference-inventory",
    declaredPath: manifest.adapter.xref,
    text: inventoryText,
    sha256: sha256Bytes(inventoryFetch.bytes),
    byteLength: inventoryFetch.bytes.byteLength,
    mediaType: inventoryFetch.mediaType,
    provenance: provenanceOf(inventoryFetch),
  });
  const inventoryParsed = mystXrefInventorySchema.safeParse(
    parseJsonArtifact(inventoryText, "cross-reference inventory", "artifact-malformed"),
  );
  if (!inventoryParsed.success) {
    throw new PublicationRegistrationError(
      "cross-reference-inventory-invalid",
      "The publication's cross-reference inventory could not be read.",
    );
  }
  const inventory: MystXrefInventory = inventoryParsed.data;

  // 6. Published-structure verification: every target resolves, and the page
  //    the inventory points at really carries the claim node.
  const publishedRootUrl = choosePublishedRoot(manifest, observedRoot, warnings);
  const publishedLocations = await verifyPublishedStructure({
    claims,
    inventory,
    observedRoot,
    publishedRootUrl,
    fetcher: input.fetcher,
    limits,
    budget,
    warnings,
  });

  // 7. Source bytes, when the publication declares an obtainable source and a
  //    resolver exists. Failure downgrades with a recorded reason; a mismatch
  //    against obtained bytes is a refusal, not a downgrade.
  let sourceVerification: PublicationSourceVerification;
  let sourceChecks;
  try {
    const result = await verifySourceBytes({
      source: manifest.publication.source,
      claims,
      resolver: input.sourceResolver,
      maxDocuments: limits.maxSourceDocuments,
    });
    sourceVerification = result.verification;
    sourceChecks = result.reached ? result.checks : undefined;
  } catch (error) {
    if (error instanceof SourceByteMismatchError) {
      throw new PublicationRegistrationError(
        "source-verification-mismatch",
        "The publication's obtained source bytes disagree with what its artifacts declare.",
        `Claim ${error.sourceLocalClaimId}: ${error.message}`,
      );
    }
    throw error;
  }
  if (sourceVerification.outcome !== "reached") {
    warn(
      warnings,
      "source-byte-verification-not-reached",
      `Source-byte verification was not reached (${sourceVerification.reason}); this observation records published structure only.`,
    );
  }

  const structuralProvenance = reachedStructuralProvenance({
    artifactDigestsMatched: true,
    declaredRecordCountsMatched: true,
    declaredPathsRevalidated: true,
    targetsResolvedInInventory: true,
    ...(sourceChecks === undefined ? {} : { sourceBytes: sourceChecks }),
  });
  if (structuralProvenance === null) {
    // Unreachable while every check above throws on failure; kept so a future
    // check that returns false rather than throwing cannot silently pass.
    throw new PublicationRegistrationError(
      "manifest-invalid",
      "The publication did not reach published-structure verification.",
    );
  }

  const capturedAt = now().toISOString();
  const capture: PublicationCaptureSet = {
    captureKey: captureKeyFor({
      requestedManifestUrl: manifestFetch.requestedUrl,
      resolvedManifestUrl: manifestFetch.finalUrl,
      artifacts,
    }),
    capturedAt,
    requestedManifestUrl: manifestFetch.requestedUrl,
    resolvedManifestUrl: manifestFetch.finalUrl,
    observedSiteRootUrl: observedRoot,
    manifestSha256,
    declaredSchemaVersion: manifest.schemaVersion,
    adapterType: manifest.adapter.type,
    ...(manifest.publication.id === undefined
      ? {}
      : { sourceLocalPublicationId: manifest.publication.id }),
    sourcesSha256: manifest.publication.version.sourcesSha256,
    ...(manifest.publication.source === undefined
      ? {}
      : { sourceDescriptor: manifest.publication.source }),
    artifacts,
  };

  let normalized: NormalizedPublication;
  try {
    normalized = normalizeMystPublication({
      manifest,
      claims,
      publicationType: input.publicationType,
      structuralProvenance,
      observedAt: capturedAt,
      ...(input.registrationKey === undefined ? {} : { registrationKey: input.registrationKey }),
    });
  } catch (error) {
    if (error instanceof PublicationIdentityError) {
      throw new PublicationRegistrationError(
        "publication-identity-insufficient",
        "The publication declares no durable identity evidence ORAtlas can key it from.",
        error.message,
      );
    }
    if (error instanceof PublicationAdapterError) {
      throw new PublicationRegistrationError(
        "declaration-authority-conflict",
        "The publication's artifacts are internally inconsistent.",
        error.message,
      );
    }
    throw error;
  }

  return {
    capture,
    manifest,
    claims,
    normalized,
    publishedLocations,
    structuralProvenance,
    sourceVerification,
    warnings,
  };
}

/**
 * Which base published claim URLs are reported against.
 *
 * The declared canonical URL is what the publication says it is served from,
 * and is what a reader should be sent to. It is never dereferenced during
 * validation, so when it disagrees with the location ORAtlas actually observed,
 * that disagreement is recorded rather than resolved.
 */
function choosePublishedRoot(
  manifest: MystPublicationManifest,
  observedRoot: string,
  warnings: PublicationRegistrationWarning[],
): string {
  if (manifest.publication.canonicalUrl === undefined) {
    warn(
      warnings,
      "canonical-url-not-declared",
      "The publication declares no canonical URL, so published locations use the observed one.",
    );
    return observedRoot;
  }
  const declared = publicationSiteRoot(manifest.publication.canonicalUrl);
  if (declared !== observedRoot) {
    warn(
      warnings,
      "canonical-url-differs-from-observed-location",
      "The publication's declared canonical URL is not the location these bytes were observed at.",
    );
  }
  return declared;
}

interface ReviewManifestCaptureInput {
  manifest: MystPublicationManifest;
  observedRoot: string;
  fetcher: PublicationArtifactFetcher;
  limits: RegistrationLimits;
  budget: FetchBudget;
  warnings: PublicationRegistrationWarning[];
}

/**
 * Capture a declared ORAtlas review manifest and check the declaration
 * authority the publication asserts is the one its artifacts support.
 *
 * `artifacts.claims.declarations` names exactly one authority. ORAtlas honours
 * that rather than merging: with `review-manifest`, the review manifest's own
 * claim stream owns claim text and attributes and the MyST records supply only
 * the source occurrence binding. Two artifacts both asserting authority is a
 * refusal, never a heuristic choice between them.
 */
async function captureReviewManifest(
  input: ReviewManifestCaptureInput,
): Promise<CapturedArtifact | undefined> {
  const declaredPath = input.manifest.oratlas?.reviewManifest;
  const authority = input.manifest.artifacts.claims.declarations;

  if (declaredPath === undefined) {
    if (authority === "review-manifest") {
      throw new PublicationRegistrationError(
        "declaration-authority-conflict",
        "The publication delegates its claim declarations to a review manifest it does not declare.",
      );
    }
    return undefined;
  }

  const url = resolveArtifactUrl(input.observedRoot, declaredPath);
  const fetched = await retrieve(
    input.fetcher,
    url,
    ARTIFACT_MEDIA_TYPES.reviewManifest,
    input.limits.maxReviewManifestBytes,
    input.budget,
    "artifact-unreachable",
  );
  const text = decodeArtifact(fetched, "review manifest");
  const raw = parseJsonArtifact(text, "review manifest", "artifact-malformed");
  const declaresClaims =
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as Record<string, unknown>).artifacts === "object" &&
    (raw as { artifacts: Record<string, unknown> }).artifacts !== null &&
    (raw as { artifacts: Record<string, unknown> }).artifacts.claims !== undefined;

  if (declaresClaims && authority !== "review-manifest") {
    throw new PublicationRegistrationError(
      "declaration-authority-conflict",
      "The publication ships a review manifest that declares claims while asserting its own source is authoritative.",
    );
  }
  if (!declaresClaims && authority === "review-manifest") {
    throw new PublicationRegistrationError(
      "declaration-authority-conflict",
      "The publication delegates its claim declarations to a review manifest that declares no claim stream.",
    );
  }
  if (authority === "review-manifest") {
    input.warnings.push({
      code: "review-manifest-captured-not-interpreted",
      message:
        "The review manifest is authoritative for claim declarations; its bytes were captured and its claim stream was not reinterpreted here.",
    });
  }

  return {
    kind: "review-manifest",
    declaredPath,
    text,
    sha256: sha256Bytes(fetched.bytes),
    byteLength: fetched.bytes.byteLength,
    mediaType: fetched.mediaType,
    provenance: provenanceOf(fetched),
  };
}

interface PublishedStructureInput {
  claims: readonly MystClaimRecord[];
  inventory: MystXrefInventory;
  observedRoot: string;
  publishedRootUrl: string;
  fetcher: PublicationArtifactFetcher;
  limits: RegistrationLimits;
  budget: FetchBudget;
  warnings: PublicationRegistrationWarning[];
}

/**
 * Published-structure verification, using only externally published bytes.
 *
 * Every claim target must resolve in the publication's own inventory, and the
 * page data that inventory points at must structurally contain a node carrying
 * the identifier. No source Markdown is read, needed, or assumed available.
 */
async function verifyPublishedStructure(
  input: PublishedStructureInput,
): Promise<PublishedClaimLocation[]> {
  const pageData = new Map<string, unknown>();
  const locations: PublishedClaimLocation[] = [];

  for (const claim of input.claims) {
    const reference = findXrefReference(input.inventory, claim.target.identifier);
    if (reference === undefined || typeof reference.url !== "string") {
      throw new PublicationRegistrationError(
        "cross-reference-target-missing",
        "A declared claim target does not resolve in the publication's cross-reference inventory.",
        `Target identifier: ${claim.target.identifier}.`,
      );
    }
    // The inventory is untrusted. A location that is not inside the publication
    // is refused rather than resolved: it would make ORAtlas fetch, and publish
    // a link to, bytes the publication does not serve.
    if (!isSafeInventoryPath(reference.url)) {
      throw new PublicationRegistrationError(
        "cross-reference-inventory-invalid",
        "The publication's inventory names a location outside the publication.",
        `Target identifier: ${claim.target.identifier}.`,
      );
    }

    // Site-root-relative, so the publication's root is the base. Resolving
    // against a canonical URL with a path would silently drop that path.
    const publishedUrl = resolvePublishedUrl(
      input.publishedRootUrl,
      reference.url,
      claim.target.htmlId,
    );

    if (reference.data !== undefined && !isSafeInventoryPath(reference.data)) {
      throw new PublicationRegistrationError(
        "cross-reference-inventory-invalid",
        "The publication's inventory names a page location outside the publication.",
        `Target identifier: ${claim.target.identifier}.`,
      );
    }
    const dataPath = typeof reference.data === "string" ? reference.data : undefined;
    if (dataPath === undefined) {
      warn(
        input.warnings,
        "cross-reference-entry-declares-no-page-data",
        "The publication's inventory names no page data for at least one claim, so no page-level structural check was possible.",
      );
      locations.push({
        sourceLocalClaimId: claim.id,
        publishedUrl,
        pageDataVerified: false,
      });
      continue;
    }

    if (!pageData.has(dataPath)) {
      const dataUrl = resolvePublishedUrl(input.observedRoot, dataPath);
      const fetched = await retrieve(
        input.fetcher,
        dataUrl,
        ARTIFACT_MEDIA_TYPES.pageData,
        input.limits.maxPageDataBytes,
        input.budget,
        "artifact-unreachable",
      );
      const text = decodeArtifact(fetched, "page data");
      pageData.set(dataPath, parseJsonArtifact(text, "page data", "artifact-malformed"));
    }

    if (!pageDataContainsIdentifier(pageData.get(dataPath), claim.target.identifier)) {
      throw new PublicationRegistrationError(
        "page-data-claim-node-missing",
        "A declared claim is not present in the published page the publication's inventory points at.",
        `Target identifier: ${claim.target.identifier}.`,
      );
    }

    locations.push({
      sourceLocalClaimId: claim.id,
      publishedUrl,
      pageDataPath: dataPath,
      pageDataVerified: true,
    });
  }

  return locations;
}
