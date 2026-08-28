import { z } from "zod";

/**
 * MyST's own cross-reference inventory, read as *evidence*, not as an ORAtlas
 * contract.
 *
 * `myst.xref.json` belongs to the authoring toolchain: the publication
 * interoperability specification points at it and deliberately neither defines
 * nor reproduces it. So this schema reads only the three fields a consumer
 * needs — the identifier, the published URL, and the page data path — and
 * tolerates everything else the toolchain writes, rather than pretending to
 * own a format it does not.
 *
 * What is *not* tolerated is size: an untrusted inventory is capped, so a
 * hostile publication cannot make ORAtlas hold an unbounded reference list.
 */

export const MAX_XREF_REFERENCES = 50_000;

export const mystXrefReferenceSchema = z
  .object({
    identifier: z.string().max(500).optional(),
    /** Site-root-relative path of the page serving the target. */
    url: z.string().max(2_000).optional(),
    /** Site-root-relative path of the page's data document. */
    data: z.string().max(2_000).optional(),
    kind: z.string().max(120).optional(),
    html_id: z.string().max(300).optional(),
  })
  .passthrough();
export type MystXrefReference = z.infer<typeof mystXrefReferenceSchema>;

export const mystXrefInventorySchema = z
  .object({
    references: z.array(mystXrefReferenceSchema).max(MAX_XREF_REFERENCES),
  })
  .passthrough();
export type MystXrefInventory = z.infer<typeof mystXrefInventorySchema>;

/**
 * Whether an inventory value is a location *inside* the publication.
 *
 * Inventory URLs are site-root-relative paths (`/`, `/results`,
 * `/content/results.json`). The inventory belongs to the authoring toolchain
 * and is untrusted like everything else the publication serves, so a value
 * that is not such a path is refused rather than resolved:
 *
 * - an absolute URL (`https://elsewhere.example/x`) wins over the base during
 *   resolution, which would make ORAtlas fetch, and publish a link to, a host
 *   the publication does not serve;
 * - a protocol-relative URL (`//elsewhere.example/x`) does the same after the
 *   leading slashes are stripped;
 * - a `..` segment resolves back out of the publication's deployment path.
 *
 * None of these can escape ORAtlas — every retrieval is still re-admitted by
 * the outbound URL policy — but all three would make ORAtlas attribute someone
 * else's bytes to this publication, which is the thing that matters here.
 */
export function isSafeInventoryPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.includes("\\") || value.includes(":")) return false;
  if (value.startsWith("//")) return false;
  return value.split("/").every((segment) => segment !== "." && segment !== "..");
}

/** The inventory entry a claim target joins to, or `undefined`. */
export function findXrefReference(
  inventory: MystXrefInventory,
  identifier: string,
): MystXrefReference | undefined {
  return inventory.references.find((reference) => reference.identifier === identifier);
}

/**
 * Walk a published page-data document looking for the node an identifier names.
 *
 * The document is untrusted JSON from an external site, so the walk is
 * iterative (a hostile document can be deeply nested) and bounded in both node
 * count and depth. Nothing in the document is executed, rendered or evaluated:
 * this only asks whether a node carrying the identifier structurally exists.
 */
export interface PageNodeSearchLimits {
  maxNodes: number;
  maxDepth: number;
}

export const DEFAULT_PAGE_NODE_SEARCH_LIMITS: PageNodeSearchLimits = {
  maxNodes: 200_000,
  maxDepth: 200,
};

export function pageDataContainsIdentifier(
  document: unknown,
  identifier: string,
  limits: PageNodeSearchLimits = DEFAULT_PAGE_NODE_SEARCH_LIMITS,
): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: document, depth: 0 }];
  let visited = 0;

  while (stack.length > 0) {
    const entry = stack.pop()!;
    visited += 1;
    if (visited > limits.maxNodes || entry.depth > limits.maxDepth) return false;
    const value = entry.value;
    if (Array.isArray(value)) {
      for (const child of value) stack.push({ value: child, depth: entry.depth + 1 });
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    if (record.identifier === identifier || record.html_id === identifier) return true;
    for (const child of Object.values(record)) {
      if (typeof child === "object" && child !== null) {
        stack.push({ value: child, depth: entry.depth + 1 });
      }
    }
  }
  return false;
}
