import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrustVerificationBadge, trustVerificationPresentation } from "./TrustVerificationBadge.js";

describe("TRUST verification presentation", () => {
  it.each([
    ["platform-verified", "human-reviewed", "Atlas structurally verified"],
    ["unverified-import", "repository-fact", "Repository/source-native — not verified by Atlas"],
    ["stale-verification", "warning", "Atlas verification stale"],
    ["legacy-unknown", "warning", "Legacy verification unknown"],
    ["future-state", "warning", "Unknown verification state"],
  ])("maps %s to a fail-closed badge", (state, kind, label) => {
    expect(trustVerificationPresentation(state)).toEqual({ kind, label });
    expect(renderToStaticMarkup(<TrustVerificationBadge state={state} />)).toContain(label);
  });
});
