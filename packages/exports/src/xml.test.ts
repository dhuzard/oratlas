import { describe, expect, it } from "vitest";
import { escapeXml } from "./xml.js";

describe("escapeXml", () => {
  it("escapes the five XML metacharacters", () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;",
    );
  });

  it("drops characters illegal in XML 1.0 while keeping tab/LF/CR", () => {
    expect(escapeXml("a\u0001b\u0008c\u000Bd\u000Ce\u001Ff\uFFFEg")).toBe("abcdefg");
    expect(escapeXml("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });

  it("drops lone surrogates but keeps valid surrogate pairs", () => {
    expect(escapeXml("a\uD800b")).toBe("ab");
    expect(escapeXml("a\uDC00b")).toBe("ab");
    expect(escapeXml("a\uD83D\uDE00b")).toBe("a\uD83D\uDE00b");
  });
});
