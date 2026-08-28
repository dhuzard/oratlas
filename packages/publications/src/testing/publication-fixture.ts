import { createHash } from "node:crypto";
import { canonicalJson, MYST_PUBLICATION_PROTOCOL_VERSION } from "@oratlas/contracts";

/**
 * A deterministic externally hosted MyST publication, built the way a real one
 * is: every digest computed from the bytes it covers, rather than pasted in.
 *
 * The fixture deliberately deploys under a **subpath**, because that is where
 * the cross-reference resolution rule actually bites — a site-root-relative
 * inventory URL resolved naively against a canonical URL with a path silently
 * loses the path.
 *
 * It also deliberately does **not** serve its Markdown. A deployed site serves
 * rendered pages, its inventory and the protocol artifacts; it does not serve
 * `results.md`. Published-structure verification therefore has to work from the
 * published bytes alone, which is exactly what the tests assert.
 */

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function codePointIndexOf(haystack: string, needle: string): number {
  const utf16Index = haystack.indexOf(needle);
  if (utf16Index < 0) throw new Error("Fixture body not found in its own source document.");
  return Array.from(haystack.slice(0, utf16Index)).length;
}

export const FIXTURE_CLAIM_ID = "hpa-axis-mediation";
export const FIXTURE_SECOND_CLAIM_ID = "stress-window-specificity";
export const FIXTURE_DOCUMENT_PATH = "results.md";

export interface FixtureClaimSpec {
  id: string;
  body: string;
  claimType?: string;
  qualification?: string;
}

const DEFAULT_CLAIMS: FixtureClaimSpec[] = [
  {
    id: FIXTURE_CLAIM_ID,
    body: "Persistent behavioural change after adolescent stress is mediated in part by lasting alterations in hypothalamic–pituitary–adrenal axis reactivity [@mccormick2010].",
    claimType: "mechanistic",
  },
  {
    id: FIXTURE_SECOND_CLAIM_ID,
    body: "The effect is specific to the early adolescent window and is not reproduced by an equivalent adult stressor.",
    claimType: "empirical",
    qualification: "Rodent models only.",
  },
];

export interface PublicationFixtureOptions {
  /** Deployment path the site is served under, e.g. `/adolescent-stress`. */
  deployPath?: string;
  /** Canonical URL the publication declares. */
  canonicalUrl?: string;
  /** Author-declared source-local publication id. */
  publicationId?: string;
  claims?: FixtureClaimSpec[];
  /** Source descriptor the manifest declares, if any. */
  source?: Record<string, unknown>;
  declarations?: "publication-source" | "review-manifest";
  /** Ship an ORAtlas review manifest at this path. */
  reviewManifestPath?: string;
  /** Content of the shipped review manifest. */
  reviewManifest?: Record<string, unknown>;
}

export interface PublicationFixture {
  /** Site paths (rooted at the server origin) to file bodies. */
  files: Record<string, string>;
  /** Site path of the manifest, e.g. `/adolescent-stress/oratlas.manifest.json`. */
  manifestPath: string;
  /** Exact source document the site does *not* serve. */
  sourceDocuments: Record<string, string>;
  manifest: Record<string, unknown>;
  claimRecords: Record<string, unknown>[];
  claimsJsonl: string;
  sourcesSha256: string;
  deployPath: string;
}

/** Build the exact source document a set of claim specs is declared in. */
function buildSourceDocument(claims: readonly FixtureClaimSpec[]): {
  document: string;
  blocks: Map<string, { startLine: number; endLine: number }>;
} {
  const lines: string[] = ["# Results", "", "Prose that precedes every declaration.", ""];
  const blocks = new Map<string, { startLine: number; endLine: number }>();
  for (const claim of claims) {
    const startLine = lines.length + 1;
    lines.push(`\`\`\`{oratlas:claim} ${claim.id}`);
    if (claim.claimType !== undefined) lines.push(`:type: ${claim.claimType}`);
    if (claim.qualification !== undefined) lines.push(`:qualification: ${claim.qualification}`);
    lines.push("");
    lines.push(claim.body);
    lines.push("```");
    blocks.set(claim.id, { startLine, endLine: lines.length });
    lines.push("");
  }
  return { document: lines.join("\n"), blocks };
}

export function buildPublicationFixture(
  options: PublicationFixtureOptions = {},
): PublicationFixture {
  const deployPath = options.deployPath ?? "/adolescent-stress";
  const canonicalUrl = options.canonicalUrl ?? `https://example.org${deployPath}/`;
  const claims = options.claims ?? DEFAULT_CLAIMS;
  const declarations = options.declarations ?? "publication-source";

  const { document, blocks } = buildSourceDocument(claims);
  const documentSha256 = sha256(document);
  const characters = Array.from(document);

  const claimRecords = claims.map((claim) => {
    const block = blocks.get(claim.id)!;
    const start = codePointIndexOf(document, claim.body);
    const end = start + Array.from(claim.body).length;
    const blockText = document
      .split("\n")
      .slice(block.startLine - 1, block.endLine)
      .join("\n");
    const declarationSha256 = sha256(
      canonicalJson({
        schemaVersion: MYST_PUBLICATION_PROTOCOL_VERSION,
        id: claim.id,
        body: claim.body,
        claimType: claim.claimType,
        qualification: claim.qualification,
      }),
    );
    const declaresLocally = declarations === "publication-source";
    return {
      schemaVersion: MYST_PUBLICATION_PROTOCOL_VERSION,
      id: claim.id,
      ...(declaresLocally ? { text: claim.body } : {}),
      ...(declaresLocally && claim.claimType !== undefined ? { claimType: claim.claimType } : {}),
      ...(declaresLocally && claim.qualification !== undefined
        ? { qualification: claim.qualification }
        : {}),
      target: { type: "myst-xref", identifier: claim.id, htmlId: claim.id },
      source: {
        documentPath: FIXTURE_DOCUMENT_PATH,
        documentSha256,
        startLine: block.startLine,
        endLine: block.endLine,
        blockSha256: sha256(blockText),
      },
      selector: {
        representation: "oratlas-myst-source-utf8-v1",
        unit: "body",
        textQuote: {
          type: "TextQuoteSelector",
          exact: claim.body,
          prefix: characters.slice(Math.max(0, start - 96), start).join(""),
          suffix: characters.slice(end, end + 96).join(""),
        },
        textPosition: { type: "TextPositionSelector", start, end },
      },
      declarationSha256,
    } satisfies Record<string, unknown>;
  });

  const claimsJsonl = claimRecords.map((record) => JSON.stringify(record)).join("\n") + "\n";
  const sourcesSha256 = sha256(
    canonicalJson({
      schemaVersion: MYST_PUBLICATION_PROTOCOL_VERSION,
      documents: [{ path: FIXTURE_DOCUMENT_PATH, sha256: documentSha256 }],
    }),
  );

  const manifest: Record<string, unknown> = {
    schemaVersion: MYST_PUBLICATION_PROTOCOL_VERSION,
    generator: { name: "@oratlas/myst", version: "0.2.0" },
    publication: {
      id: options.publicationId ?? "adolescent-stress-review",
      canonicalUrl,
      title: "Adolescent stress and persistent behavioural change",
      version: { sourcesSha256, label: "v1.0.0" },
      ...(options.source === undefined ? {} : { source: options.source }),
    },
    adapter: { type: "myst", xref: "myst.xref.json" },
    artifacts: {
      claims: {
        path: "oratlas/claims.jsonl",
        format: "jsonl",
        records: claimRecords.length,
        sha256: sha256(claimsJsonl),
        declarations,
      },
    },
    ...(options.reviewManifestPath === undefined
      ? {}
      : { oratlas: { reviewManifest: options.reviewManifestPath } }),
  };

  // MyST's own inventory: site-root-relative URLs, and a data document per page.
  const inventory = {
    version: "1",
    myst: "1.6.0",
    references: [
      { kind: "page", url: "/results", data: "/content/results.json", identifier: "results" },
      ...claimRecords.map((record) => ({
        kind: "oratlas:claim",
        identifier: (record.target as { identifier: string }).identifier,
        html_id: (record.target as { htmlId: string }).htmlId,
        url: "/results",
        data: "/content/results.json",
      })),
    ],
  };

  const pageData = {
    version: 1,
    slug: "results",
    mdast: {
      type: "root",
      children: [
        { type: "heading", depth: 1, children: [{ type: "text", value: "Results" }] },
        ...claims.map((claim) => ({
          type: "oratlasClaim",
          identifier: claim.id,
          html_id: claim.id,
          data: { oratlas: { kind: "claim", id: claim.id } },
          children: [{ type: "paragraph", children: [{ type: "text", value: claim.body }] }],
        })),
      ],
    },
  };

  const files: Record<string, string> = {
    [`${deployPath}/oratlas.manifest.json`]: JSON.stringify(manifest, null, 2),
    [`${deployPath}/oratlas/claims.jsonl`]: claimsJsonl,
    [`${deployPath}/myst.xref.json`]: JSON.stringify(inventory),
    [`${deployPath}/content/results.json`]: JSON.stringify(pageData),
  };
  if (options.reviewManifestPath !== undefined) {
    files[`${deployPath}/${options.reviewManifestPath}`] = JSON.stringify(
      options.reviewManifest ?? {
        schemaVersion: "1.0.0",
        review: { title: "Adolescent stress and persistent behavioural change" },
        artifacts: { claims: "knowledge/claims.jsonl" },
      },
    );
  }

  return {
    files,
    manifestPath: `${deployPath}/oratlas.manifest.json`,
    sourceDocuments: { [FIXTURE_DOCUMENT_PATH]: document },
    manifest,
    claimRecords,
    claimsJsonl,
    sourcesSha256,
    deployPath,
  };
}
