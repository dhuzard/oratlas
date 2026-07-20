import { ProvenanceBadge } from "@oratlas/ui";

export type TrustVerificationPresentation = {
  kind: "human-reviewed" | "repository-fact" | "warning";
  label: string;
};

/**
 * Fail-closed presentation for TRUST verification provenance. Only the
 * platform-owned state receives Atlas verification styling; imported and
 * unknown values can never be promoted by display code.
 */
export function trustVerificationPresentation(state: string): TrustVerificationPresentation {
  switch (state) {
    case "platform-verified":
      return { kind: "human-reviewed", label: "Atlas structurally verified" };
    case "unverified-import":
      return {
        kind: "repository-fact",
        label: "Repository/source-native — not verified by Atlas",
      };
    case "stale-verification":
      return { kind: "warning", label: "Atlas verification stale" };
    case "legacy-unknown":
      return { kind: "warning", label: "Legacy verification unknown" };
    default:
      return { kind: "warning", label: "Unknown verification state" };
  }
}

export function TrustVerificationBadge({ state }: { state: string }) {
  const presentation = trustVerificationPresentation(state);
  return <ProvenanceBadge kind={presentation.kind}>{presentation.label}</ProvenanceBadge>;
}
