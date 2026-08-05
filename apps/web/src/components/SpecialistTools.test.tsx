import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SpecialistToolBreadcrumb, SpecialistTools } from "./SpecialistTools.js";

describe("SpecialistTools", () => {
  it("renders every specialist route in the contextual index", () => {
    const html = renderToStaticMarkup(<SpecialistTools />);

    for (const href of [
      "/nodes",
      "/graph",
      "/synthesis",
      "/coverage",
      "/replications",
      "/explore",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain("Specialist tools for deeper analysis");
  });

  it("returns specialist pages to the primary Explore flow", () => {
    const html = renderToStaticMarkup(<SpecialistToolBreadcrumb current="Coverage gaps" />);

    expect(html).toContain('href="/explore"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Coverage gaps");
  });
});
