import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parsePreservedMarkdown, safeUnicode } from "./article-reader";

describe("preserved article reader", () => {
  it("creates deterministic structure while leaving raw HTML inert text", () => {
    const document = parsePreservedMarkdown(
      "---\ntitle: untrusted\n---\n# Results\n\n<script>alert(1)</script>\n\n- first\n- second\n",
    );
    expect(document.toc).toEqual([{ id: "article-section-1-results", level: 1, text: "Results" }]);
    expect(document.blocks).toContainEqual({
      kind: "paragraph",
      text: "<script>alert(1)</script>",
    });
    expect(document.blocks).toContainEqual({
      kind: "list",
      ordered: false,
      items: ["first", "second"],
    });
  });

  it("repairs unpaired UTF-16 surrogates before UTF-8 output", () => {
    expect(safeUnicode(`before\ud800after\udc00`)).toBe("before�after�");
    expect(safeUnicode("valid 🧪 français தமிழ்")).toBe("valid 🧪 français தமிழ்");
  });
});
