import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projectSourceEvidenceLinks } from "@oratlas/extractor";
import {
  LINEAGE_CLAIM_ID,
  loadEvidenceLineageFixture,
} from "../../../../packages/extractor/src/fixtures/evidence-lineage";
import { SourceEvidenceLinksCard } from "./SourceEvidenceLinksCard";

const fixture = loadEvidenceLineageFixture();
const SIDECAR_PATH = "knowledge/oratlas/source-native-trust.json";
const claimText = (
  JSON.parse(fixture.reviewFiles["knowledge/oratlas/claims.jsonl"]!.split("\n")[3]!) as {
    text: string;
  }
).text;

function links(overrides: { doiIsExample?: boolean; sidecar?: string } = {}) {
  return projectSourceEvidenceLinks({
    claimLocalId: LINEAGE_CLAIM_ID,
    claimText,
    sidecar: {
      path: SIDECAR_PATH,
      content: overrides.sidecar ?? fixture.reviewFiles[SIDECAR_PATH]!,
    },
    citations: [
      {
        localCitationId: "Cardin2009",
        doi: "10.1038/nature08002",
        doiIsExample: overrides.doiIsExample ?? false,
      },
      { localCitationId: "Sohal2009", doi: "10.1038/nature07991", doiIsExample: false },
    ],
    relations: [
      {
        citationLocalId: "Cardin2009",
        relationType: "supports",
        sourceLocation: "Abstract, page 1",
      },
      {
        citationLocalId: "Sohal2009",
        relationType: "partially-supports",
        sourceLocation: "Abstract",
      },
    ],
  });
}

describe("SourceEvidenceLinksCard", () => {
  it("renders producer findings with producer, packet digest and source-native labels", () => {
    const html = renderToStaticMarkup(<SourceEvidenceLinksCard links={links()} />);
    expect(html).toContain("Producer findings (external evidence packet)");
    expect(html).toContain("finding:cardin2009-f1");
    expect(html).toContain("finding:cardin2009-f2");
    expect(html).toContain("producer: diggypaper");
    expect(html).toContain("57db54da7f2daa448ef3dda28b1921ef14d0475fa6270f3f4905c23027ded2a9");
    expect(html).toContain("10.5555/oratlas.fixture.packet (example, not linked)");
    expect(html).not.toContain("https://doi.org/10.5555");
    expect(html).toContain("passage passage:cardin2009-p1");
    expect(html).toContain("match exact");
    expect(html).toContain("seip-support-v1");
    expect(html).toContain("source-native");
    expect(html).toContain("not an ORAtlas TRUST assessment");
    expect(html).toContain("has not imported or verified");
    expect(html).not.toMatch(/atlas.verified|peer.reviewed|replicat/i);
  });

  it("links a real DOI locator and says plainly when a links/1 sidecar has no passage data", () => {
    const sidecar = JSON.parse(fixture.reviewFiles[SIDECAR_PATH]!);
    for (const link of sidecar.evidence_links) {
      link.packet_locator = { kind: "doi", doi: "10.5281/zenodo.1234567" };
    }
    expect(
      renderToStaticMarkup(
        <SourceEvidenceLinksCard links={links({ sidecar: JSON.stringify(sidecar) })} />,
      ),
    ).toContain('href="https://doi.org/10.5281/zenodo.1234567"');
    for (const link of sidecar.evidence_links) {
      for (const key of [
        "packet_locator",
        "finding_revision",
        "verification_level",
        "passages",
        "assessments",
      ]) {
        delete link[key];
      }
    }
    const html = renderToStaticMarkup(
      <SourceEvidenceLinksCard links={links({ sidecar: JSON.stringify(sidecar) })} />,
    );
    expect(html).toContain("No passage data in the sidecar.");
    expect(html).toContain("location not declared");
  });

  it("never links an example DOI outward", () => {
    const html = renderToStaticMarkup(
      <SourceEvidenceLinksCard links={links({ doiIsExample: true })} />,
    );
    expect(html).toContain("(example)");
    expect(html).not.toContain("https://doi.org/10.1038/nature08002");
    expect(html).toContain("https://doi.org/10.1038/nature07991");
  });

  it("escapes repository-controlled text instead of rendering HTML", () => {
    const sidecar = JSON.parse(fixture.reviewFiles[SIDECAR_PATH]!);
    sidecar.evidence_links[0].finding_id = "finding:<script>alert(1)</script>";
    const html = renderToStaticMarkup(
      <SourceEvidenceLinksCard links={links({ sidecar: JSON.stringify(sidecar) })} />,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("states stale and unreadable sidecars without showing lineage, and hides when none is declared", () => {
    const stale = projectSourceEvidenceLinks({
      claimLocalId: LINEAGE_CLAIM_ID,
      claimText: "different text",
      sidecar: { path: SIDECAR_PATH, content: fixture.reviewFiles[SIDECAR_PATH]! },
      citations: [],
      relations: [],
    });
    const staleHtml = renderToStaticMarkup(<SourceEvidenceLinksCard links={stale} />);
    expect(staleHtml).toContain("Sidecar does not match this version");
    expect(staleHtml).not.toContain("finding:cardin2009-f1 </span>");
    expect(staleHtml).not.toContain("high_trust");
    const invalid = projectSourceEvidenceLinks({
      claimLocalId: LINEAGE_CLAIM_ID,
      claimText,
      sidecar: { path: SIDECAR_PATH, content: "{" },
      citations: [],
      relations: [],
    });
    expect(renderToStaticMarkup(<SourceEvidenceLinksCard links={invalid} />)).toContain(
      "Sidecar unreadable",
    );
    const none = projectSourceEvidenceLinks({
      claimLocalId: LINEAGE_CLAIM_ID,
      claimText,
      citations: [],
      relations: [],
    });
    expect(renderToStaticMarkup(<SourceEvidenceLinksCard links={none} />)).toBe("");
  });
});
