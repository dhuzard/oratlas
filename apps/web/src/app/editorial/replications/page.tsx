import { redirect } from "next/navigation";
import { type Metadata } from "next";
import { Notice } from "@oratlas/ui";
import { getCurrentUser, isEditor } from "@/lib/auth";
import { listEditorialReplicationBriefs } from "@/lib/replication-marketplace";
import { getReplicationTriage } from "@/lib/synthesis";
import { ReplicationBriefEditor } from "./ReplicationBriefEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Replication brief editorial controls" };

export default async function ReplicationEditorialPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (!isEditor(user)) {
    return (
      <Notice tone="error" title="Editor access required">
        Only human editors can register or publish replication briefs.
      </Notice>
    );
  }
  const [briefs, triage] = await Promise.all([
    listEditorialReplicationBriefs(),
    getReplicationTriage(100),
  ]);

  return (
    <article>
      <p>
        <a href="/editorial">← Editorial dashboard</a>
      </p>
      <h1>Replication brief editorial controls</h1>
      <Notice tone="warning" title="Human publication only">
        The deterministic list is editorial triage, not scientific truth. It cannot create or
        publish a brief. Editors must supply a scoped rationale and explicitly publish each draft.
      </Notice>
      <details>
        <summary>Candidate claim references ({triage.length})</summary>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Band</th>
                <th>Claim reference</th>
                <th>Claim</th>
              </tr>
            </thead>
            <tbody>
              {triage.map((candidate) => (
                <tr key={candidate.claimId}>
                  <td>{candidate.triageBand.replaceAll("-", " ")}</td>
                  <td className="mono">
                    {candidate.reviewVersionId}|{candidate.localClaimId}
                  </td>
                  <td>{candidate.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <ReplicationBriefEditor briefs={briefs} />
    </article>
  );
}
