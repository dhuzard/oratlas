import type { Metadata } from "next";
import Link from "next/link";
import { PUBLIC_PATHS, canonicalOrigin } from "@/lib/public-discovery";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "API & agents",
  description: "Use ORAtlas public APIs to discover and inspect exact scientific records.",
};

const curl = (path: string) => `curl --fail --show-error "${canonicalOrigin().origin}${path}"`;

export default function ApiDocsPage() {
  return (
    <article className="prose">
      <p className="home-eyebrow">Public interfaces</p>
      <h1>API &amp; agents</h1>
      <p className="lead">
        ORAtlas exposes accepted reviews, immutable versions, claims, provenance, lifecycle state,
        and governed graph relations through server-rendered pages and JSON APIs. Public reads do
        not require authentication; writes require an attributable session and explicit user action.
      </p>

      <h2>Quick start</h2>
      <ol>
        <li>Search for an accepted review and select its slug.</li>
        <li>Retrieve the current review and read its exact version identifier.</li>
        <li>Retrieve that immutable version and select a claim&apos;s local identifier.</li>
        <li>
          Retrieve the claim passport and use its canonical node and node-version identifiers.
        </li>
        <li>Traverse the graph, following the opaque cursor until no next page remains.</li>
      </ol>

      <pre>
        <code>{curl(`${PUBLIC_PATHS.search}?contentType=review&q=neuroscience&pageSize=5`)}</code>
      </pre>
      <pre>
        <code>{`SLUG='review-slug'\n${curl("/api/reviews/$SLUG")}`}</code>
      </pre>
      <pre>
        <code>{`VERSION_ID='rv_…'\n${curl("/api/reviews/$SLUG/versions/$VERSION_ID")}`}</code>
      </pre>
      <pre>
        <code>{`CLAIM_ID='C-001'\n${curl("/api/claims/$VERSION_ID/$CLAIM_ID")}`}</code>
      </pre>
      <pre>
        <code>
          {`NODE_ID='kn_…'\nNODE_VERSION_ID='knv_…'\n${curl(
            `${PUBLIC_PATHS.graph}?seed=$NODE_ID&version=$NODE_VERSION_ID&status=authoritative&direction=both&limit=25`,
          )}`}
        </code>
      </pre>

      <h2>Contract and access</h2>
      <p>
        The complete operation, parameter, response, authentication, and error contract is available
        as <Link href={PUBLIC_PATHS.openapiYaml}>OpenAPI YAML</Link> or{" "}
        <Link href={PUBLIC_PATHS.openapiJson}>OpenAPI JSON</Link>. A 429 response includes{" "}
        <code>Retry-After</code>. Cursor values are opaque: preserve the documented query and pass
        the returned cursor unchanged. A bounded page is not evidence that traversal is complete.
        The <code>authoritative</code> graph status includes source assertions and editor-confirmed
        relations while preserving their distinct statuses.
      </p>
      <p>
        Archive search uses one-based <code>page</code> and bounded <code>pageSize</code>{" "}
        parameters. Continue while the response indicates that more result pages exist; do not
        confuse search page numbers with the graph&apos;s signed opaque cursor.
      </p>

      <h2>Exact records and scientific meaning</h2>
      <p>
        Cite exact review and node versions. Archive acceptance preserves a record; it is not peer
        review, truth, consensus, or scientific endorsement. Source assertions and editor-confirmed
        relations remain distinct. TRUST assessments concern a particular claim-evidence relation
        under a named protocol, never a universal score for a work.
      </p>
      <p>
        Corrections, supersession, withdrawal, and tombstones are exposed through lifecycle state.
        Re-check lifecycle state before reuse and do not retain content that a tombstone no longer
        permits the service to return.
      </p>

      <h2>Further guidance</h2>
      <p>
        Read the <Link href={PUBLIC_PATHS.agentGuide}>agent access guide</Link> for governance,
        prompt-injection boundaries, write safety, provenance, exports, and interpretation rules.
      </p>
    </article>
  );
}
