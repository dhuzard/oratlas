import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SpecialistToolBreadcrumb, SpecialistTools } from "./SpecialistTools";

describe("SpecialistTools", () => {
  it("keeps every specialist route available outside the primary navigation", () => {
    const html = renderToStaticMarkup(<SpecialistTools />);

    for (const href of [
      "/nodes",
      "/graph",
      "/synthesis",
      "/coverage",
      "/replications",
      "/discuss",
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
