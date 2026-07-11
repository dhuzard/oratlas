import { describe, expect, it } from "vitest";
import { serializeJsonForHtml } from "./json-for-html.js";

describe("serializeJsonForHtml", () => {
  it("prevents an untrusted JSON-LD value from terminating its script element", () => {
    const value = {
      headline: '</script><script nonce="stolen">alert(1)</script>',
      author: "A & B > C",
      separators: "line\u2028paragraph\u2029",
    };

    const serialized = serializeJsonForHtml(value);

    expect(serialized.toLowerCase()).not.toContain("</script");
    expect(serialized).not.toMatch(/[<>&]/);
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(JSON.parse(serialized)).toEqual(value);
  });

  it("rejects values that JSON cannot represent at the top level", () => {
    expect(() => serializeJsonForHtml(undefined)).toThrow(TypeError);
  });
});
