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

      <h2 id="two-record-recipe">Read, inspect and reuse two exact claims</h2>
      <p>
        This read-only recipe uses curl and jq with two archived-review claim passports. Replace the
        placeholders with URL-encoded identifiers returned by the API. Keep the two versions
        separate even when the text or source-local identifiers match. No comparison resource is
        created or saved on the server.
      </p>
      <pre>
        <code>{`ORIGIN='${canonicalOrigin().origin}'
LEFT_VERSION='exact-left-review-version'
LEFT_CLAIM='left-local-claim-id'
RIGHT_VERSION='exact-right-review-version'
RIGHT_CLAIM='right-local-claim-id'

curl --fail --show-error "$ORIGIN/api/claims/$LEFT_VERSION/$LEFT_CLAIM" -o left.json
curl --fail --show-error "$ORIGIN/api/claims/$RIGHT_VERSION/$RIGHT_CLAIM" -o right.json

# Inspect the claims, exact source links and any existing canonical bindings.
jq '{text, versionId, localClaimId, graphIdentity, links, evidence}' left.json right.json

# Retain exact references for reuse; this is a local file, not an ORAtlas write.
jq -s 'map({reference: .links.html, sourceVersion: .versionId,
  canonical: .graphIdentity, source: .links.reviewVersion})' left.json right.json > exact-pair.json`}</code>
      </pre>
      <p>
        Read both exact source versions via each passport’s <code>links.reviewVersion</code>.
        Inspect lifecycle state, evidence selectors and each relation’s assessments. If a passport
        has a canonical binding, use its returned <code>links.graph</code> to inspect the graph;
        absent bindings must remain absent. For example:
      </p>
      <pre>
        <code>{`GRAPH_PATH=$(jq -r '.links.graph // empty' left.json)
if [ -n "$GRAPH_PATH" ]; then
  curl --fail --show-error "$ORIGIN$GRAPH_PATH" -o left-graph.json
  jq '{nodes, edges, page}' left-graph.json
fi`}</code>
      </pre>
      <p>
        Repeat for the right record. Follow the graph response’s <code>page.nextCursor</code> or
        HTTP <code>Link</code> with <code>rel="next"</code>, retaining the seed, version and other
        query parameters. Compare exact endpoint tuples and relation direction, and keep every
        edge’s status and rationale. A page with no connecting edge establishes only that none was
        returned in that bounded view; it does not establish agreement, disagreement or absence
        throughout the graph. Repeated citations are not independent corroboration.
      </p>
      <p>
        For a canonical node reference, read{" "}
        <code>
          /api/nodes/{"{nodeId}"}/versions/{"{versionId}"}
        </code>
        . For an external source occurrence, read{" "}
        <code>/api/publication-claim-occurrences/{"{id}"}</code>, then its exact publication-version
        record and <code>/api/publication-versions/{"{id}"}/packet</code>. Its{" "}
        <code>canonicalBinding</code> may be null; when present it supplies the exact graph tuple
        and graph link. These are different response shapes, not interchangeable claim passport
        objects. Preserve the occurrence ID and publication-version ID without inferring identity
        from matching text or digests.
      </p>
      <p>
        Reuse exact human/API links and retain protocol identities, relation status, lifecycle
        state, bounds and any packet digest returned. Re-check availability before reuse; never
        replace a denied or tombstoned exact record with a latest-version alias or cached content.
        There is no public comparison REST endpoint: this recipe composes existing reads locally. It
        grants no permission to comment, file a challenge, propose a relation or record an
        assessment.
      </p>

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
