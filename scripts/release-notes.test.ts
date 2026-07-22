import { describe, expect, it } from "vitest";
import { notesForVersion, validateReleaseTag } from "./release-notes.js";

describe("release notes", () => {
  it("extracts exactly the dated version section", () => {
    const changelog =
      "# Changelog\n\n## [Unreleased]\n\n## [1.2.3] - 2026-07-20\n\n- Shipped.\n\n## [1.2.2] - 2026-07-01\n\n[Unreleased]: https://example.test\n";
    expect(notesForVersion(changelog, "1.2.3")).toBe("## [1.2.3] - 2026-07-20\n\n- Shipped.\n");
    expect(notesForVersion(changelog, "1.2.2")).toBe("## [1.2.2] - 2026-07-01\n");
  });

  it("rejects mismatched tags and missing changelog sections", () => {
    expect(() => validateReleaseTag("v1.2.4", "1.2.3")).toThrow(/does not match/);
    expect(() => notesForVersion("## [Unreleased]\n", "1.2.3")).toThrow(/no dated/);
  });
});
