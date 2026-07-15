import Link from "next/link";
import { notFound } from "next/navigation";
import { type Metadata } from "next";
import { Badge, Card, Notice, StatusPill } from "@oratlas/ui";
import { getCurrentUser, isEditor } from "@/lib/auth";
import {
  getPublicReplicationBrief,
  isReplicationBriefClaimant,
} from "@/lib/replication-marketplace";
import { ReplicationBriefActions } from "./ReplicationBriefActions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const brief = await getPublicReplicationBrief((await params).slug);
  return { title: brief?.title ?? "Replication brief" };
}

export default async function ReplicationBriefPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [brief, user] = await Promise.all([getPublicReplicationBrief(slug), getCurrentUser()]);
  if (!brief) notFound();
  const userIsClaimant = user ? await isReplicationBriefClaimant(slug, user.id) : false;
  const scopeEntries = Object.entries(brief.scope).filter(([, value]) => value);

  return (
    <article>
      <p>
        <Link href="/replications">← Replication marketplace</Link>
      </p>
      <div className="btn-row">
        <StatusPill status={brief.status} />
        <Badge tone="neutral">{brief.effortBand} effort</Badge>
      </div>
      <h1>{brief.title}</h1>
      <Notice tone="warning" title="An editorial opportunity, not a promised outcome">
        This brief records a human editorial priority based on deterministic evidence-gap rules. It
        does not say a claim is true or false, predict a replication result, rank researchers, offer
        payment, or confer scientific endorsement.
      </Notice>
      <p>{brief.summary}</p>

      <h2>Linked claims</h2>
      {brief.claims.map((claim) => (
        <Card as="article" key={`${claim.reviewVersionId}:${claim.localClaimId}`}>
          <p>
            <Link href={claim.passportPath}>{claim.text}</Link>
          </p>
          <p className="muted">Review: {claim.reviewSlug}</p>
        </Card>
      ))}

      <h2>Registered scope</h2>
      <dl>
        {scopeEntries.map(([key, value]) => (
          <div key={key}>
            <dt>{key.replaceAll(/([A-Z])/g, " $1")}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <h2>Expected information gain rationale</h2>
      <p>{brief.expectedInformationGain}</p>

      <h2>Protocol and citations</h2>
      <ul>
        {brief.protocolUrl ? (
          <li>
            Protocol: <a href={brief.protocolUrl}>{brief.protocolUrl}</a>
          </li>
        ) : null}
        {brief.citationUrls.map((url) => (
          <li key={url}>
            Citation: <a href={url}>{url}</a>
          </li>
        ))}
      </ul>

      <h2>Attributable lifecycle</h2>
      <ul>
        <li>
          Drafted by {brief.createdByLogin} on {brief.createdAt.slice(0, 10)}
        </li>
        <li>
          Published by {brief.publishedByLogin ?? "unknown editor"} on{" "}
          {brief.publishedAt?.slice(0, 10)}
        </li>
        {brief.claimedByLogin ? (
          <li>
            Claimed by {brief.claimedByLogin} on {brief.claimedAt?.slice(0, 10)}
            {brief.claimNote ? ` — ${brief.claimNote}` : ""}
          </li>
        ) : null}
        {brief.completedByLogin ? (
          <li>
            Completion recorded by {brief.completedByLogin} on {brief.completedAt?.slice(0, 10)}
          </li>
        ) : null}
        {brief.withdrawnByLogin ? (
          <li>
            Withdrawn by {brief.withdrawnByLogin} on {brief.withdrawnAt?.slice(0, 10)} —{" "}
            {brief.withdrawalReason}
          </li>
        ) : null}
      </ul>
      {brief.completionUrl ? (
        <Notice tone="info" title="Completion record (not an outcome judgement)">
          <p>{brief.completionSummary}</p>
          <p>
            <a href={brief.completionUrl}>Open the public completion record</a>
          </p>
        </Notice>
      ) : null}

      <ReplicationBriefActions
        slug={brief.slug}
        status={brief.status}
        revision={brief.revision}
        signedIn={Boolean(user)}
        isClaimant={userIsClaimant}
        isEditor={isEditor(user)}
      />
    </article>
  );
}
