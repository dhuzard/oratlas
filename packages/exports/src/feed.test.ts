import { describe, expect, it } from "vitest";
import { atomFeed } from "./feed.js";

describe("atomFeed", () => {
  it("produces an escaped Atom document with entries", () => {
    const xml = atomFeed({
      id: "https://atlas.example.org/",
      title: "Open Review Atlas — recently accepted",
      siteUrl: "https://atlas.example.org/archive",
      feedUrl: "https://atlas.example.org/api/feeds/atom",
      updated: "2026-06-15T00:00:00.000Z",
      entries: [
        {
          id: "https://atlas.example.org/reviews/a/versions/v-1",
          title: `Review <b>& "quotes"</b>`,
          url: "https://atlas.example.org/reviews/a/versions/v-1",
          updated: "2026-06-15T00:00:00.000Z",
          summary: "Summary <script>x</script>",
          authors: ["Ada Lovelace"],
        },
      ],
    });
    expect(xml).toContain(`<feed xmlns="http://www.w3.org/2005/Atom">`);
    expect(xml).toContain("Review &lt;b&gt;&amp; &quot;quotes&quot;&lt;/b&gt;");
    expect(xml).toContain("Summary &lt;script&gt;x&lt;/script&gt;");
    expect(xml).toContain("<author><name>Ada Lovelace</name></author>");
    expect(xml).not.toContain("<script>");
  });

  it("falls back to a publisher author when the entry has none", () => {
    const xml = atomFeed({
      id: "urn:feed",
      title: "t",
      siteUrl: "https://atlas.example.org/",
      feedUrl: "https://atlas.example.org/api/feeds/atom",
      updated: "2026-06-15T00:00:00.000Z",
      entries: [
        {
          id: "urn:e1",
          title: "e",
          url: "https://atlas.example.org/reviews/a",
          updated: "2026-06-15T00:00:00.000Z",
          authors: [],
        },
      ],
    });
    expect(xml).toContain("<author><name>Open Review Atlas</name></author>");
  });
});
