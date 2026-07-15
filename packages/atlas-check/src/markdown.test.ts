import { describe, expect, it } from "vitest";
import { hasSubstantiveMarkdown, markdownSections, normalizeHeading } from "./markdown.js";

describe("Markdown section parser", () => {
  it("does not treat headings inside untrusted fenced examples as evidence", () => {
    const sections = markdownSections(
      "# FAIR\n```md\n## Findable\nPretend evidence that must not count.\n```\n## Accessible\nActual evidence is documented here.",
    );
    expect(sections.map((section) => section.heading)).toEqual(["fair", "accessible"]);
  });

  it("does not let adversarial HTML comments count as documentation", () => {
    expect(hasSubstantiveMarkdown("<!<!-- hidden evidence that is long enough -->-->")).toBe(false);
    expect(hasSubstantiveMarkdown("<!-- unclosed evidence that is long enough")).toBe(false);
  });

  it("normalizes tag-shaped heading markup without replace-once sanitization", () => {
    expect(normalizeHeading("<strong>FAIR</strong> principles")).toBe("fair principles");
    expect(normalizeHeading("<scr<script>ipt>Accessible</script>")).toBe("ipt accessible");
  });
});
