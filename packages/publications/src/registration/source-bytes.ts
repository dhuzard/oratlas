import { createHash } from "node:crypto";
import {
  canonicalJson,
  MYST_PUBLICATION_PROTOCOL_VERSION,
  type PublicationSourceDescriptor,
  type PublicationSourceUnavailableReason,
  type PublicationSourceVerification,
} from "@oratlas/contracts";
import { type MystClaimRecord } from "../adapters/myst.js";
import { type SourceByteChecks } from "../structural-provenance.js";

/**
 * Source-byte verification: the level that needs the publication's own source,
 * not just what its site serves.
 *
 * A deployed site serves rendered pages, its cross-reference inventory and the
 * protocol artifacts. It does **not** generally serve `results.md`. So a
 * consumer holding only the published site cannot check `documentSha256`,
 * `blockSha256` or the raw-source selectors: the bytes those digests cover are
 * not published. Everything here therefore depends on a resolver that can
 * obtain the exact source bytes, and there is deliberately no fallback that
 * pretends otherwise.
 *
 * Publication source is **provenance, not scientific evidence.** Reaching this
 * level says the author's declarations match the bytes they were made over. It
 * says nothing about whether a claim is correct, supported or replicated.
 */

/** Why an exact-byte read could not be performed. */
export type SourceDocumentFailure = { reason: PublicationSourceUnavailableReason };

export type SourceDocumentRead =
  | { ok: true; text: string }
  | ({ ok: false } & SourceDocumentFailure);

/**
 * A resolver that can obtain the exact bytes of one source document.
 *
 * Implementations must be exact and deterministic: the same descriptor and
 * path must always yield the same bytes, or the descriptor must be refused.
 * A resolver that approximates — a mutable branch, an unpinned tag, a
 * reconstruction — is worse than none, because it would let a publication look
 * source-verified when nothing exact was ever checked.
 */
export interface PublicationSourceDocumentResolver {
  /** Short name retained in the audit record. */
  readonly name: string;
  /** Whether this resolver can obtain exact bytes for the descriptor. */
  supports(source: PublicationSourceDescriptor): { supported: true } | SourceDocumentFailure;
  readDocument(
    source: PublicationSourceDescriptor,
    documentPath: string,
  ): Promise<SourceDocumentRead>;
}

/** A source-byte check that failed against obtained bytes. Never a downgrade. */
export class SourceByteMismatchError extends Error {
  readonly sourceLocalClaimId: string;
  readonly check: "document-digest" | "block-digest" | "selector" | "declaration-digest";

  constructor(
    check: "document-digest" | "block-digest" | "selector" | "declaration-digest",
    sourceLocalClaimId: string,
    message: string,
  ) {
    super(message);
    this.name = "SourceByteMismatchError";
    this.check = check;
    this.sourceLocalClaimId = sourceLocalClaimId;
  }
}

export interface SourceByteVerificationInput {
  source: PublicationSourceDescriptor | undefined;
  claims: readonly MystClaimRecord[];
  resolver: PublicationSourceDocumentResolver | undefined;
  /** Cap on the number of distinct source documents one registration reads. */
  maxDocuments: number;
}

export type SourceByteVerificationResult =
  | { reached: true; checks: SourceByteChecks; verification: PublicationSourceVerification }
  | { reached: false; verification: PublicationSourceVerification };

function unavailable(
  reason: PublicationSourceUnavailableReason,
  sourceType?: PublicationSourceDescriptor["type"],
): SourceByteVerificationResult {
  return {
    reached: false,
    verification: {
      outcome: "unavailable",
      reason,
      ...(sourceType === undefined ? {} : { sourceType }),
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Code points, not UTF-16 code units: the selector frame counts code points. */
function codePoints(value: string): string[] {
  return Array.from(value);
}

/**
 * Recompute the claim-declaration digest from the source span the selector
 * quotes.
 *
 * Only possible when the selector quotes the directive *body* verbatim and the
 * quote was not truncated. A `block` selector quotes the fenced block rather
 * than the body MyST read, and a truncated quote is by definition not the whole
 * body, so neither can reproduce the digest. Both are reported as
 * `source-declaration-not-recomputable` rather than being approximated.
 */
function declarationDigestRecomputable(record: MystClaimRecord): boolean {
  if (record.selector.unit !== "body") return false;
  const quoted = codePoints(record.selector.textQuote.exact).length;
  return quoted < 2_000;
}

function recomputeDeclarationSha256(record: MystClaimRecord, body: string): string {
  return sha256(
    canonicalJson({
      schemaVersion: MYST_PUBLICATION_PROTOCOL_VERSION,
      id: record.id,
      body,
      claimType: record.claimType,
      qualification: record.qualification,
    }),
  );
}

/**
 * Attempt source-byte verification, returning either the reached checks or an
 * explicit, recorded reason it was not reached.
 *
 * A resolver failure downgrades to `published-structure` **with the reason
 * recorded**. Obtained bytes that disagree with the declarations do not
 * downgrade: they mean the publication's own manifest is inconsistent with its
 * own source, which is a fail-closed rejection, not a lower level.
 */
export async function verifySourceBytes(
  input: SourceByteVerificationInput,
): Promise<SourceByteVerificationResult> {
  const { source, resolver, claims } = input;
  if (source === undefined) return unavailable("no-source-declared");
  if (resolver === undefined) return unavailable("no-source-resolver-configured", source.type);

  const support = resolver.supports(source);
  if (!("supported" in support)) return unavailable(support.reason, source.type);

  const documentPaths = [...new Set(claims.map((claim) => claim.source.documentPath))].sort();
  if (documentPaths.length > input.maxDocuments) {
    return unavailable("source-document-unavailable", source.type);
  }

  const documents = new Map<string, string>();
  for (const documentPath of documentPaths) {
    const read = await resolver.readDocument(source, documentPath);
    if (!read.ok) return unavailable(read.reason, source.type);
    documents.set(documentPath, read.text);
  }

  for (const record of claims) {
    const document = documents.get(record.source.documentPath)!;

    if (sha256(document) !== record.source.documentSha256) {
      throw new SourceByteMismatchError(
        "document-digest",
        record.id,
        "The obtained source document does not match the digest the publication declared.",
      );
    }

    const lines = document.split("\n");
    if (record.source.endLine > lines.length) {
      throw new SourceByteMismatchError(
        "block-digest",
        record.id,
        "The declared line span does not exist in the obtained source document.",
      );
    }
    const block = lines.slice(record.source.startLine - 1, record.source.endLine).join("\n");
    if (sha256(block) !== record.source.blockSha256) {
      throw new SourceByteMismatchError(
        "block-digest",
        record.id,
        "The declared source block does not match the digest the publication declared.",
      );
    }

    const characters = codePoints(document);
    const { start, end } = record.selector.textPosition;
    if (end > characters.length) {
      throw new SourceByteMismatchError(
        "selector",
        record.id,
        "The declared selector position lies outside the obtained source document.",
      );
    }
    const quoted = characters.slice(start, end).join("");
    if (quoted !== record.selector.textQuote.exact) {
      throw new SourceByteMismatchError(
        "selector",
        record.id,
        "The declared selector does not locate its quoted span in the obtained source.",
      );
    }

    if (!declarationDigestRecomputable(record)) {
      return unavailable("source-declaration-not-recomputable", source.type);
    }
    if (recomputeDeclarationSha256(record, quoted) !== record.declarationSha256) {
      throw new SourceByteMismatchError(
        "declaration-digest",
        record.id,
        "The claim declaration digest does not recompute from the obtained source.",
      );
    }
  }

  return {
    reached: true,
    checks: {
      sourceDigestsMatched: true,
      declarationDigestsRecomputed: true,
      sourceSelectorsLocated: true,
    },
    verification: {
      outcome: "reached",
      sourceType: source.type,
      resolver: resolver.name,
      documentsChecked: documents.size,
    },
  };
}
