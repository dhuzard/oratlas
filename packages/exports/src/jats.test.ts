import { describe, expect, it } from "vitest";
import { jats } from "./jats.js";
import { type VersionExportInput } from "./types.js";

const base: VersionExportInput = {
  platformVersion: "0.1.0",
  slug: "sample-review",
  versionId: "v-1",
  title: "A Sample Review",
  abstract: "Abstract text.",
  contributors: [{ displayName: "Ada Lovelace", givenName: "Ada", familyName: "Lovelace" }],
  keywords: ["methods"],
  domains: [],
  licenseSpdx: "CC-BY-4.0",
  publishedAt: "2026-06-15T00:00:00.000Z",
  versionDoi: "10.5281/zenodo.123456",
  isExample: false,
  repositoryUrl: "https://github.com/example-lab/sample-review",
  commitSha: "a".repeat(40),
  treeSha: "b".repeat(40),
  canonicalUrl: "https://atlas.example.org/reviews/sample-review/versions/v-1",
};

describe("jats", () => {
  it("produces JATS front matter with DOI, license and source provenance", () => {
    const xml = jats(base);
    expect(xml).toContain(`<article-id pub-id-type="doi">10.5281/zenodo.123456</article-id>`);
    expect(xml).toContain("<surname>Lovelace</surname>");
    expect(xml).toContain("<license-p>CC-BY-4.0</license-p>");
    expect(xml).toContain("<meta-name>source-commit</meta-name>");
    expect(xml).toContain("<meta-name>oratlas-platform-version</meta-name>");
    expect(xml).toContain("<meta-value>0.1.0</meta-value>");
    expect(xml).toContain(`<meta-value>${"a".repeat(40)}</meta-value>`);
    expect(xml).toContain(`self-uri xlink:href="${base.canonicalUrl}"`);
  });

  it("escapes markup in repository-derived text", () => {
    const xml = jats({
      ...base,
      title: `<script>alert("x")</script> & ]]>`,
      abstract: `"quoted" <b>bold</b>`,
    });
    expect(xml).not.toContain("<script>");
    expect(xml).not.toContain("<b>");
    expect(xml).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; ]]&gt;");
  });

  it("omits example DOIs and ORCIDs and records the omission", () => {
    const xml = jats({
      ...base,
      isExample: true,
      versionDoi: "10.5555/zenodo.1",
      contributors: [{ displayName: "Demo Person", orcid: "0000-0000-0000-0001" }],
    });
    expect(xml).not.toContain("article-id");
    expect(xml).not.toContain("orcid.org");
    expect(xml).toContain("<meta-name>identifier-note</meta-name>");
  });
});
