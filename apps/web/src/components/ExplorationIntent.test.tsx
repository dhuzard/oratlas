import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExplorationIntent } from "./ExplorationIntent.js";

describe("ExplorationIntent", () => {
  it("preserves explicit known nodes without restoring legacy result views", () => {
    const html = renderToStaticMarkup(
      <ExplorationIntent
        query="replay"
        selectedInterests={["data-code"]}
        knownNodeIds={["known-node-1", "known-node-2"]}
      />,
    );

    expect(html).toContain('name="known" value="known-node-1"');
    expect(html).toContain('name="known" value="known-node-2"');
    expect(html).toContain(
      'href="/explore?q=replay&amp;known=known-node-1&amp;known=known-node-2"',
    );
    expect(html).not.toContain('name="view"');
  });
});
