import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalJson,
  claimRecordSchema as reviewClaimRecordSchema,
  reviewManifestSchema,
  safeRepoRelativePathSchema,
  type PublicationCaptureArtifactKind,
  type PublicationSourceDescriptor,
  type PublicationType,
} from "@oratlas/contracts";
import {
  mystClaimRecordSchema,
  mystPublicationManifestSchema,
  normalizeMystPublication,
  type MystClaimRecord,
  type MystPublicationManifest,
  type NormalizedPublication,
} from "./adapters/myst.js";
import type { RemoteFetcher, RemoteFetchResult, RemoteHttpProvenance } from "./remote-fetch.js";

export const DEFAULT_PUBLICATION_REGISTRATION_LIMITS = {
  manifestBytes: 256 * 1024,
  claimsBytes: 8 * 1024 * 1024,
  xrefBytes: 8 * 1024 * 1024,
  reviewManifestBytes: 256 * 1024,
  reviewClaimsBytes: 8 * 1024 * 1024,
  pageDataBytes: 8 * 1024 * 1024,
  sourceDocumentBytes: 4 * 1024 * 1024,
  sourceTotalBytes: 32 * 1024 * 1024,
  maxClaimRecords: 5_000,
  maxArtifacts: 64,
  maxPageNodes: 100_000,
  totalOperationTimeoutMs: 30_000,
} as const;

export type PublicationRegistrationLimits = typeof DEFAULT_PUBLICATION_REGISTRATION_LIMITS;

export class PublicationRegistrationError extends Error {
  constructor(
    public readonly code:
      | "invalid-manifest"
      | "invalid-artifact"
      | "unsupported-protocol"
      | "limit-exceeded"
      | "integrity-mismatch"
      | "missing-target"
      | "source-mismatch",
    message: string,
  ) {
    super(message);
    this.name = "PublicationRegistrationError";
  }
}

export class PublicationSourceUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "PublicationSourceUnavailableError";
  }
}

export interface SourceDocumentBytes {
  path: string;
  bytes: Uint8Array;
  mediaType: string;
  requestedUrl?: string;
  observedUrl?: string;
  provenance?: RemoteHttpProvenance;
}

export interface PublicationSourceResolver {
  resolve(
    source: PublicationSourceDescriptor,
    documentPaths: readonly string[],
    options: {
      signal: AbortSignal;
      maxDocumentBytes: number;
      maxTotalBytes: number;
    },
  ): Promise<readonly SourceDocumentBytes[]>;
}

export interface ObservedPublicationArtifact {
  artifactKind: PublicationCaptureArtifactKind;
  declaredPath?: string;
  requestedUrl?: string;
  observedUrl?: string;
  mediaType: string;
  bytes: Uint8Array;
  contentSha256: string;
  declaredSha256?: string;
  provenance?: RemoteHttpProvenance;
}

export interface VerifiedExternalPublication {
  manifest: MystPublicationManifest;
  normalized: NormalizedPublication;
  artifacts: ObservedPublicationArtifact[];
  warnings: string[];
  resolvedClaimUrls: ReadonlyMap<string, string>;
  delegatedDeclarations?: ReadonlyMap<
    string,
    { text: string; claimType?: string; qualification?: string }
  >;
}

export interface VerifyExternalPublicationInput {
  manifestUrl: string;
  publicationType: PublicationType;
  registrationKey?: string;
  fetcher: RemoteFetcher;
  sourceResolver?: PublicationSourceResolver;
  limits?: Partial<PublicationRegistrationLimits>;
  now?: () => Date;
}

const JSON_MEDIA_TYPES = ["application/json", "text/plain", "application/octet-stream"];
const JSONL_MEDIA_TYPES = [
  "application/jsonl",
  "application/x-ndjson",
  "application/json",
  "text/plain",
  "application/octet-stream",
];

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PublicationRegistrationError("invalid-artifact", `${label} is not valid UTF-8.`);
  }
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  const text = decodeUtf8(bytes, label);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PublicationRegistrationError("invalid-artifact", `${label} is not valid JSON.`);
  }
}

function parseManifest(bytes: Uint8Array): MystPublicationManifest {
  const value = parseJson(bytes, "Publication manifest");
  if (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    (value as { schemaVersion?: unknown }).schemaVersion !== "0.2.0"
  ) {
    throw new PublicationRegistrationError(
      "unsupported-protocol",
      "The publication manifest uses an unsupported schema version.",
    );
  }
  const parsed = mystPublicationManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new PublicationRegistrationError(
      "invalid-manifest",
      "The publication manifest does not satisfy the closed schema 0.2.0 contract.",
    );
  }
  return parsed.data;
}

function parseJsonl<S extends z.ZodTypeAny>(
  bytes: Uint8Array,
  schema: S,
  label: string,
  maxRecords: number,
): z.infer<S>[] {
  const text = decodeUtf8(bytes, label);
  if (text.length === 0) return [];
  if (text.includes("\r") || !text.endsWith("\n")) {
    throw new PublicationRegistrationError(
      "invalid-artifact",
      `${label} must be LF-separated JSON Lines with a trailing LF.`,
    );
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.some((line) => line.length === 0)) {
    throw new PublicationRegistrationError("invalid-artifact", `${label} contains a blank record.`);
  }
  if (lines.length > maxRecords) {
    throw new PublicationRegistrationError(
      "limit-exceeded",
      `${label} exceeds the ${maxRecords}-record registration limit.`,
    );
  }
  return lines.map((line, index) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new PublicationRegistrationError(
        "invalid-artifact",
        `${label} contains malformed JSON on line ${index + 1}.`,
      );
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new PublicationRegistrationError(
        "invalid-artifact",
        `${label} contains an invalid record on line ${index + 1}.`,
      );
    }
    return parsed.data;
  });
}

function directoryUrl(url: string): string {
  return new URL("./", url).href;
}

function artifactUrl(manifestFinalUrl: string, path: string): string {
  const safe = safeRepoRelativePathSchema.safeParse(path);
  if (!safe.success) {
    throw new PublicationRegistrationError(
      "invalid-manifest",
      "The publication declares an unsafe artifact path.",
    );
  }
  const root = new URL(directoryUrl(manifestFinalUrl));
  const resolved = new URL(safe.data, root);
  if (resolved.origin !== root.origin || !resolved.pathname.startsWith(root.pathname)) {
    throw new PublicationRegistrationError(
      "invalid-manifest",
      "The publication artifact path resolves outside its manifest root.",
    );
  }
  return resolved.href;
}

/** Normative schema-0.2.0 MyST URL resolution, with traversal/origin checks. */
export function resolveMystPublishedUrl(
  canonicalUrl: string,
  xrefUrl: string,
  htmlId?: string,
): string {
  const hasControlCharacter = Array.from(xrefUrl).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (
    xrefUrl.length > 2_000 ||
    !xrefUrl.startsWith("/") ||
    xrefUrl.startsWith("//") ||
    xrefUrl.includes("\\") ||
    hasControlCharacter
  ) {
    throw new PublicationRegistrationError(
      "invalid-artifact",
      "A MyST inventory entry has an unsafe published URL.",
    );
  }
  const base = new URL(canonicalUrl.endsWith("/") ? canonicalUrl : `${canonicalUrl}/`);
  const resolved = new URL(xrefUrl.replace(/^\/+/, ""), base);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) {
    throw new PublicationRegistrationError(
      "invalid-artifact",
      "A MyST inventory URL resolves outside the publication root.",
    );
  }
  if (htmlId) resolved.hash = htmlId;
  return resolved.href;
}

function capture(
  artifactKind: PublicationCaptureArtifactKind,
  response: RemoteFetchResult,
  declaredPath?: string,
  declaredSha256?: string,
): ObservedPublicationArtifact {
  return {
    artifactKind,
    ...(declaredPath === undefined ? {} : { declaredPath }),
    requestedUrl: response.requestedUrl,
    observedUrl: response.finalUrl,
    mediaType: response.mediaType,
    bytes: response.bytes,
    contentSha256: sha256(response.bytes),
    ...(declaredSha256 === undefined ? {} : { declaredSha256 }),
    provenance: response.provenance,
  };
}

const xrefReferenceSchema = z
  .object({
    identifier: z.string().min(1).max(300),
    url: z.string().min(1).max(2_000),
    data: safeRepoRelativePathSchema,
  })
  .passthrough();
const xrefInventorySchema = z
  .object({ references: z.array(xrefReferenceSchema).max(100_000) })
  .passthrough();

function findPublishedClaimNode(root: unknown, record: MystClaimRecord, maxNodes: number): boolean {
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length > 0) {
    const candidate = stack.pop();
    visited += 1;
    if (visited > maxNodes) {
      throw new PublicationRegistrationError(
        "limit-exceeded",
        "Published page data exceeds the structural node limit.",
      );
    }
    if (typeof candidate !== "object" || candidate === null) continue;
    if (Array.isArray(candidate)) {
      stack.push(...candidate);
      continue;
    }
    const node = candidate as Record<string, unknown>;
    const oratlas =
      typeof node.data === "object" && node.data !== null
        ? (node.data as { oratlas?: unknown }).oratlas
        : undefined;
    if (
      node.identifier === record.target.identifier &&
      node.html_id === record.target.htmlId &&
      typeof oratlas === "object" &&
      oratlas !== null &&
      (oratlas as { kind?: unknown }).kind === "claim" &&
      (oratlas as { id?: unknown }).id === record.id
    ) {
      return true;
    }
    stack.push(...Object.values(node));
  }
  return false;
}

function sliceCodePoints(value: string, start: number, end: number): string {
  return Array.from(value).slice(start, end).join("");
}

function verifySourceDocuments(
  records: readonly MystClaimRecord[],
  documents: readonly SourceDocumentBytes[],
): ObservedPublicationArtifact[] {
  const byPath = new Map(documents.map((document) => [document.path, document]));
  if (byPath.size !== documents.length) {
    throw new PublicationRegistrationError(
      "source-mismatch",
      "The source resolver returned a document path more than once.",
    );
  }
  for (const record of records) {
    const document = byPath.get(record.source.documentPath);
    if (!document || sha256(document.bytes) !== record.source.documentSha256) {
      throw new PublicationRegistrationError(
        "source-mismatch",
        `Source bytes do not match the declaration for ${record.source.documentPath}.`,
      );
    }
    const source = decodeUtf8(document.bytes, `Source document ${document.path}`);
    const block = source
      .split("\n")
      .slice(record.source.startLine - 1, record.source.endLine)
      .join("\n");
    if (sha256(block) !== record.source.blockSha256) {
      throw new PublicationRegistrationError(
        "source-mismatch",
        `The declared source line span does not match ${document.path}.`,
      );
    }
    const { start, end } = record.selector.textPosition;
    const exact = record.selector.textQuote.exact;
    if (sliceCodePoints(source, start, end) !== exact) {
      throw new PublicationRegistrationError(
        "source-mismatch",
        `The source selector does not locate claim ${record.id}.`,
      );
    }
    const prefix = record.selector.textQuote.prefix;
    const suffix = record.selector.textQuote.suffix;
    if (
      (prefix !== undefined && !sliceCodePoints(source, 0, start).endsWith(prefix)) ||
      (suffix !== undefined &&
        !sliceCodePoints(source, end, Array.from(source).length).startsWith(suffix))
    ) {
      throw new PublicationRegistrationError(
        "source-mismatch",
        `The source quote context does not locate claim ${record.id}.`,
      );
    }
    if (record.selector.unit !== "body") {
      throw new PublicationSourceUnavailableError(
        `Claim ${record.id} uses a block selector; schema 0.2.0 does not expose enough bytes to recompute its declaration digest without executing a MyST parser.`,
      );
    }
    if (Array.from(exact).length >= 2_000) {
      throw new PublicationSourceUnavailableError(
        `Claim ${record.id} reaches the schema-0.2.0 text-quote cap; the complete declaration body cannot be reconstructed without executing a MyST parser.`,
      );
    }
    const declarationDigest = sha256(
      canonicalJson({
        schemaVersion: "0.2.0",
        id: record.id,
        body: exact,
        claimType: record.claimType,
        qualification: record.qualification,
      }),
    );
    if (declarationDigest !== record.declarationSha256) {
      throw new PublicationRegistrationError(
        "source-mismatch",
        `The declaration digest does not match claim ${record.id}.`,
      );
    }
  }
  return documents.map((document) => ({
    artifactKind: "source-document",
    declaredPath: document.path,
    ...(document.requestedUrl === undefined ? {} : { requestedUrl: document.requestedUrl }),
    ...(document.observedUrl === undefined ? {} : { observedUrl: document.observedUrl }),
    mediaType: document.mediaType,
    bytes: document.bytes,
    contentSha256: sha256(document.bytes),
    ...(document.provenance === undefined ? {} : { provenance: document.provenance }),
  }));
}

export async function verifyExternalPublication(
  input: VerifyExternalPublicationInput,
): Promise<VerifiedExternalPublication> {
  const limits = { ...DEFAULT_PUBLICATION_REGISTRATION_LIMITS, ...input.limits };
  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), limits.totalOperationTimeoutMs);
  const warnings: string[] = [];
  const artifacts: ObservedPublicationArtifact[] = [];
  try {
    const manifestResponse = await input.fetcher.fetch(input.manifestUrl, {
      maxBytes: limits.manifestBytes,
      acceptedMediaTypes: JSON_MEDIA_TYPES,
      signal: controller.signal,
    });
    artifacts.push(capture("publication-manifest", manifestResponse));
    const manifest = parseManifest(manifestResponse.bytes);
    if (manifest.artifacts.claims.records > limits.maxClaimRecords) {
      throw new PublicationRegistrationError(
        "limit-exceeded",
        `The manifest exceeds the ${limits.maxClaimRecords}-claim registration limit.`,
      );
    }

    const claimsUrl = artifactUrl(manifestResponse.finalUrl, manifest.artifacts.claims.path);
    const xrefUrl = artifactUrl(manifestResponse.finalUrl, manifest.adapter.xref);
    const [claimsResponse, xrefResponse] = await Promise.all([
      input.fetcher.fetch(claimsUrl, {
        maxBytes: limits.claimsBytes,
        acceptedMediaTypes: JSONL_MEDIA_TYPES,
        signal: controller.signal,
      }),
      input.fetcher.fetch(xrefUrl, {
        maxBytes: limits.xrefBytes,
        acceptedMediaTypes: JSON_MEDIA_TYPES,
        signal: controller.signal,
      }),
    ]);
    const claimsDigest = sha256(claimsResponse.bytes);
    if (claimsDigest !== manifest.artifacts.claims.sha256) {
      throw new PublicationRegistrationError(
        "integrity-mismatch",
        "The claims artifact SHA-256 does not match the manifest.",
      );
    }
    artifacts.push(
      capture(
        "claim-stream",
        claimsResponse,
        manifest.artifacts.claims.path,
        manifest.artifacts.claims.sha256,
      ),
      capture("cross-reference-inventory", xrefResponse, manifest.adapter.xref),
    );
    const records = parseJsonl(
      claimsResponse.bytes,
      mystClaimRecordSchema,
      "Claims artifact",
      limits.maxClaimRecords,
    );
    if (records.length !== manifest.artifacts.claims.records) {
      throw new PublicationRegistrationError(
        "integrity-mismatch",
        "The claims artifact record count does not match the manifest.",
      );
    }
    const ids = new Set<string>();
    for (const record of records) {
      if (ids.has(record.id)) {
        throw new PublicationRegistrationError(
          "invalid-artifact",
          `Source-local claim id ${record.id} is duplicated.`,
        );
      }
      ids.add(record.id);
    }

    let delegatedDeclarations:
      Map<string, { text: string; claimType?: string; qualification?: string }> | undefined;
    if (manifest.artifacts.claims.declarations === "review-manifest") {
      if (!manifest.oratlas) {
        throw new PublicationRegistrationError(
          "invalid-manifest",
          "The manifest delegates declarations without declaring a review manifest.",
        );
      }
      const reviewUrl = artifactUrl(manifestResponse.finalUrl, manifest.oratlas.reviewManifest);
      const reviewResponse = await input.fetcher.fetch(reviewUrl, {
        maxBytes: limits.reviewManifestBytes,
        acceptedMediaTypes: JSON_MEDIA_TYPES,
        signal: controller.signal,
      });
      artifacts.push(capture("review-manifest", reviewResponse, manifest.oratlas.reviewManifest));
      const parsedReview = reviewManifestSchema.safeParse(
        parseJson(reviewResponse.bytes, "Review manifest"),
      );
      if (!parsedReview.success || !parsedReview.data.artifacts?.claims) {
        throw new PublicationRegistrationError(
          "invalid-artifact",
          "The authoritative review manifest has no valid claims stream.",
        );
      }
      const reviewClaimsPath = parsedReview.data.artifacts.claims;
      const reviewClaimsUrl = artifactUrl(manifestResponse.finalUrl, reviewClaimsPath);
      const reviewClaimsResponse = await input.fetcher.fetch(reviewClaimsUrl, {
        maxBytes: limits.reviewClaimsBytes,
        acceptedMediaTypes: JSONL_MEDIA_TYPES,
        signal: controller.signal,
      });
      artifacts.push(capture("review-claim-stream", reviewClaimsResponse, reviewClaimsPath));
      const reviewClaims = parseJsonl(
        reviewClaimsResponse.bytes,
        reviewClaimRecordSchema,
        "Review claim stream",
        limits.maxClaimRecords,
      );
      delegatedDeclarations = new Map();
      for (const claim of reviewClaims) {
        if (delegatedDeclarations.has(claim.id)) {
          throw new PublicationRegistrationError(
            "invalid-artifact",
            `The authoritative review claim id ${claim.id} is duplicated.`,
          );
        }
        delegatedDeclarations.set(claim.id, {
          text: claim.text,
          ...(claim.claimType === undefined ? {} : { claimType: claim.claimType }),
          ...(claim.qualification === undefined ? {} : { qualification: claim.qualification }),
        });
      }
    }

    const parsedXref = xrefInventorySchema.safeParse(
      parseJson(xrefResponse.bytes, "MyST cross-reference inventory"),
    );
    if (!parsedXref.success) {
      throw new PublicationRegistrationError(
        "invalid-artifact",
        "The MyST cross-reference inventory is malformed or unbounded.",
      );
    }
    const baseUrl = manifest.publication.canonicalUrl ?? directoryUrl(manifestResponse.finalUrl);
    if (!manifest.publication.canonicalUrl) {
      warnings.push(
        "The manifest declares no canonicalUrl; published links use the observed manifest root.",
      );
    }
    const references = new Map<string, z.infer<typeof xrefReferenceSchema>>();
    for (const reference of parsedXref.data.references) {
      if (!ids.has(reference.identifier)) continue;
      if (references.has(reference.identifier)) {
        throw new PublicationRegistrationError(
          "invalid-artifact",
          `The MyST inventory contains duplicate target ${reference.identifier}.`,
        );
      }
      references.set(reference.identifier, reference);
    }
    const resolvedClaimUrls = new Map<string, string>();
    const recordsByPage = new Map<string, MystClaimRecord[]>();
    for (const record of records) {
      const reference = references.get(record.target.identifier);
      if (!reference) {
        throw new PublicationRegistrationError(
          "missing-target",
          `The MyST inventory does not contain target ${record.target.identifier}.`,
        );
      }
      resolvedClaimUrls.set(
        record.id,
        resolveMystPublishedUrl(baseUrl, reference.url, record.target.htmlId),
      );
      const pageRecords = recordsByPage.get(reference.data) ?? [];
      pageRecords.push(record);
      recordsByPage.set(reference.data, pageRecords);
    }
    if (artifacts.length + recordsByPage.size > limits.maxArtifacts) {
      throw new PublicationRegistrationError(
        "limit-exceeded",
        `The publication requires more than ${limits.maxArtifacts} artifacts.`,
      );
    }
    for (const [pagePath, pageRecords] of recordsByPage) {
      const pageResponse = await input.fetcher.fetch(
        artifactUrl(manifestResponse.finalUrl, pagePath),
        {
          maxBytes: limits.pageDataBytes,
          acceptedMediaTypes: JSON_MEDIA_TYPES,
          signal: controller.signal,
        },
      );
      artifacts.push(capture("published-page-data", pageResponse, pagePath));
      const page = parseJson(pageResponse.bytes, `Published page data ${pagePath}`);
      const mdast =
        typeof page === "object" && page !== null ? (page as { mdast?: unknown }).mdast : undefined;
      for (const record of pageRecords) {
        if (!findPublishedClaimNode(mdast, record, limits.maxPageNodes)) {
          throw new PublicationRegistrationError(
            "missing-target",
            `Published page data does not contain claim node ${record.id}.`,
          );
        }
      }
    }

    let provenance: "published-structure" | "source-byte" = "published-structure";
    const source = manifest.publication.source;
    if (source) {
      if (!input.sourceResolver) {
        warnings.push(
          `Source-byte verification was not reached: source type ${source.type} is not supported by the configured resolver.`,
        );
      } else if (manifest.artifacts.claims.declarations === "review-manifest") {
        warnings.push(
          "Source-byte verification was not reached: delegated schema-0.2.0 records omit the MyST declaration options needed to recompute declarationSha256 safely.",
        );
      } else if (records.length === 0) {
        warnings.push(
          "Source-byte verification was not reached: the publication declares no claim source documents to retrieve and check.",
        );
      } else {
        const documentPaths = [...new Set(records.map((record) => record.source.documentPath))];
        try {
          const documents = await input.sourceResolver.resolve(source, documentPaths, {
            signal: controller.signal,
            maxDocumentBytes: limits.sourceDocumentBytes,
            maxTotalBytes: limits.sourceTotalBytes,
          });
          const sourceCaptures = verifySourceDocuments(records, documents);
          if (artifacts.length + sourceCaptures.length > limits.maxArtifacts) {
            throw new PublicationRegistrationError(
              "limit-exceeded",
              `The publication requires more than ${limits.maxArtifacts} artifacts.`,
            );
          }
          artifacts.push(...sourceCaptures);
          provenance = "source-byte";
        } catch (error) {
          if (!(error instanceof PublicationSourceUnavailableError)) throw error;
          warnings.push(`Source-byte verification was not reached: ${error.reason}`);
        }
      }
    }

    const observedAt = (input.now ?? (() => new Date()))().toISOString();
    const normalized = normalizeMystPublication({
      manifest,
      claims: records,
      publicationType: input.publicationType,
      structuralProvenance: provenance,
      observedAt,
      ...(input.registrationKey === undefined ? {} : { registrationKey: input.registrationKey }),
      ...(delegatedDeclarations === undefined ? {} : { delegatedDeclarations }),
      verificationWarnings: warnings,
    });
    return {
      manifest,
      normalized,
      artifacts,
      warnings,
      resolvedClaimUrls,
      ...(delegatedDeclarations === undefined ? {} : { delegatedDeclarations }),
    };
  } finally {
    clearTimeout(totalTimer);
  }
}
