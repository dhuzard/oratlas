import { notFound } from "next/navigation";
import { type Metadata } from "next";
import { appBaseUrl } from "@/lib/base-url";
import { serializeJsonForHtml } from "@/lib/json-for-html";
import { nodeJsonLd } from "@/lib/node-jsonld";
import { getPublicNode } from "@/lib/node-publication";
import { NodeView } from "./NodeView";
import { ChallengesSection } from "../../reviews/[slug]/ChallengesSection";
import { getCurrentUser, isEditor } from "@/lib/auth";
import {
  isNodeChallengeContributorOfRecord,
  listNodeChallenges,
  listNodeChallengeSubjectOptions,
} from "@/lib/challenges";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: NodePageProps): Promise<Metadata> {
  const { id } = await params;
  const node = await getPublicNode(id);
  if (!node) return { title: "Knowledge node not found" };
  return {
    title: node.version.title,
    description: node.version.abstract ?? node.version.text ?? node.version.title,
    alternates: { canonical: `/nodes/${node.id}` },
    openGraph: { title: node.version.title, type: "article" },
  };
}

export default async function NodePage({ params }: NodePageProps) {
  const { id } = await params;
  const [node, challenges, subjects, user] = await Promise.all([
    getPublicNode(id),
    listNodeChallenges(id),
    listNodeChallengeSubjectOptions(id),
    getCurrentUser(),
  ]);
  if (!node) notFound();
  if (!challenges) notFound();
  const isContributor = user
    ? await isNodeChallengeContributorOfRecord(challenges.nodeEdgeProposalIds, user)
    : false;
  const canonicalUrl = `${appBaseUrl()}/nodes/${node.id}`;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonForHtml(nodeJsonLd(node, canonicalUrl)) }}
      />
      <NodeView node={node} />
      <section aria-labelledby="node-adjudications-title">
        <h2 id="node-adjudications-title">Node-relation TRUST adjudications</h2>
        <p>
          <a href={`/api/nodes/${encodeURIComponent(node.id)}/exports/challenges.json`}>
            Scholarly challenge JSON
          </a>{" "}
          ·{" "}
          <a href={`/api/nodes/${encodeURIComponent(node.id)}/exports/challenges-ro-crate`}>
            Challenge RO-Crate
          </a>
        </p>
        {subjects.length === 0 ? (
          <p className="muted">No integrity-valid node-relation adjudications are available.</p>
        ) : (
          <ul>
            {subjects.map((subject) =>
              subject.adjudication ? (
                <li id={`adjudication-${subject.adjudication.id}`} key={subject.adjudication.id}>
                  {subject.adjudication.outcome.replace(/-/g, " ")} by @
                  {subject.adjudication.adjudicatorGithubLogin} on{" "}
                  {subject.adjudication.createdAt.slice(0, 10)}
                  <details>
                    <summary>Immutable adjudication binding</summary>
                    <p className="mono">
                      disagreement sha256:{subject.adjudication.disagreementHash}
                    </p>
                    <p className="mono">outcome sha256:{subject.adjudication.outcomeHash}</p>
                  </details>
                </li>
              ) : null,
            )}
          </ul>
        )}
      </section>
      <ChallengesSection
        initial={challenges}
        subjects={subjects}
        canFile={Boolean(user)}
        viewer={
          user
            ? {
                githubLogin: user.githubLogin,
                isContributor,
                canResolve: isEditor(user),
              }
            : null
        }
      />
    </>
  );
}

interface NodePageProps {
  params: Promise<{ id: string }>;
}
