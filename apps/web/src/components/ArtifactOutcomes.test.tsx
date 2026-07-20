import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtifactOutcomes } from "./ArtifactOutcomes";

describe("ArtifactOutcomes", () => {
  it("renders artifact context without replacing claim-local empty-state copy", () => {
    const html = renderToStaticMarkup(
      <ArtifactOutcomes
        report={{
          schemaVersion: "1.1.0",
          artifactOutcomes: {
            claims: { status: "not-declared", loadedCount: 0, skippedCount: 0, sources: [] },
          },
        }}
        only={["claims"]}
      />,
    );
    expect(html).toContain("artifact-outcomes");
    expect(html).toContain("Claims");
    expect(html).toContain("Not declared");
    expect(html).not.toContain("No evidence relations were extracted for this claim");
  });
});
