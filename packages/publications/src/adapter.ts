import type {
  NormalizedPublicationProductionAssertion,
  PublicationCaptureArtifactKind,
  PublicationClaimOccurrenceRecord,
  PublicationClaimTarget,
  PublicationAdapterBinding,
  PublicationRecord,
  PublicationType,
  PublicationVersionRecord,
} from "@oratlas/contracts";

/** Adapter validation failure at the captured-publication boundary. */
export class PublicationAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicationAdapterError";
  }
}

export interface NormalizedPublication<
  TAdapterBinding extends { type: string } = PublicationAdapterBinding,
  TTarget extends { type: string; identifier: string } = PublicationClaimTarget,
> {
  publication: PublicationRecord;
  version: Omit<PublicationVersionRecord, "adapter"> & { adapter: TAdapterBinding };
  occurrences: Array<Omit<PublicationClaimOccurrenceRecord, "target"> & { target: TTarget }>;
  /** Optional source declarations. Legacy formats normally return none. */
  productionAssertions?: NormalizedPublicationProductionAssertion[];
}

/** Bytes are supplied by the hardened caller; an adapter never performs I/O. */
export interface CapturedPublicationArtifact {
  artifactKind: PublicationCaptureArtifactKind;
  declaredPath?: string;
  mediaType: string;
  bytes: Uint8Array;
  contentSha256: string;
  declaredSha256?: string;
}

export interface PublicationAdapterArtifactRequirement {
  artifactKind: PublicationCaptureArtifactKind;
  declaredPath: string;
  required: boolean;
}

export interface PublicationAdapterNormalizationContext {
  publicationType: PublicationType;
  structuralProvenance: "published-structure" | "source-byte";
  observedAt: string;
  registrationKey?: string;
  verificationWarnings?: readonly string[];
}

/**
 * Framework- and transport-free structural adapter contract.
 *
 * Implementations receive parsed values and already captured bytes. They must
 * not fetch, execute publication code, inspect dependencies, or infer who
 * authored a publication. Production provenance is a separate normalized
 * output channel.
 */
export interface PublicationAdapter<
  TManifest,
  TArtifactsInput,
  TStructureInput,
  TNormalizeInput,
  TTargetInput,
  TNormalized extends NormalizedPublication<
    { type: string },
    { type: string; identifier: string }
  > = NormalizedPublication,
> {
  readonly type: string;
  readonly supportedProtocolVersions: readonly string[];
  recognizeManifest(value: unknown): boolean;
  validateManifest(value: unknown): TManifest;
  describeRequiredArtifacts(manifest: TManifest): readonly PublicationAdapterArtifactRequirement[];
  validateCapturedArtifacts(input: TArtifactsInput): void;
  verifyPublishedStructure(input: TStructureInput): void;
  normalize(input: TNormalizeInput, context: PublicationAdapterNormalizationContext): TNormalized;
  resolvePublishedTarget(input: TTargetInput): string;
}
