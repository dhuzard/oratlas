import { describe, expect, it } from "vitest";
import {
  normalizedPublicationProductionAssertionSchema,
  publicationProductionAssertionMutationSchema,
  publicationProductionActorSchema,
  publicationRelationMutationSchema,
} from "./publication-provenance.js";

describe("publication production and transfer contracts", () => {
  it("keeps source declarations distinct from execution-backed attestations", () => {
    expect(
      normalizedPublicationProductionAssertionSchema.parse({
        sourceAssertionKey: "manifest-production-1",
        mode: "human",
        actors: [{ kind: "person", name: "Declared authors" }],
        activities: ["authoring"],
        strength: "source-declared",
      }).strength,
    ).toBe("source-declared");
    expect(() =>
      publicationProductionAssertionMutationSchema.parse({
        mode: "agentic",
        actors: [{ kind: "ai-system", name: "Research agent" }],
        activities: ["evidence-synthesis"],
        strength: "oratlas-attested",
      }),
    ).toThrow(/requires an exact execution record/);
    expect(
      publicationProductionAssertionMutationSchema.parse({
        mode: "agentic",
        actors: [{ kind: "workflow", name: "Research workflow", version: "1.2.0" }],
        activities: ["data-analysis"],
        strength: "oratlas-attested",
        executionPassportId: "passport-1",
      }).executionPassportId,
    ).toBe("passport-1");
  });

  it("models AI and software as production actors rather than scholarly contributors", () => {
    const actor = publicationProductionActorSchema.parse({
      kind: "ai-system",
      name: "ARS",
      provider: "Example Lab",
      model: "research-model",
      modelVersion: "2026-08",
      publicUrl: "https://agents.example/ars",
    });
    expect(actor.kind).toBe("ai-system");
    expect(actor).not.toHaveProperty("orcid");
    expect(actor).not.toHaveProperty("roles");
  });

  it("requires an attributable rationale for explicit publication relations", () => {
    expect(() =>
      publicationRelationMutationSchema.parse({
        targetPublicationId: "publication-2",
        relationType: "moved-to",
        rationale: "similar title",
      }),
    ).toThrow();
    expect(
      publicationRelationMutationSchema.parse({
        targetPublicationId: "publication-2",
        relationType: "moved-to",
        rationale: "An editor reviewed the public host-transfer declaration.",
      }).relationType,
    ).toBe("moved-to");
  });
});
