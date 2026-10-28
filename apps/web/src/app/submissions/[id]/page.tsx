import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, DefinitionList } from "@oratlas/ui";
import { getCurrentUser } from "@/lib/auth";
import { getOwnedSubmissionStatus } from "@/lib/submission-status";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your submission status",
  robots: { index: false, follow: false },
};

export default async function SubmissionStatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const { id } = await params;
  const submission = await getOwnedSubmissionStatus(id, user.id);
  if (!submission) notFound();
  return (
    <article>
      <h1>Your submission status</h1>
      <p>
        This page shows the current status of your exact submitted capture. Reopen this link to
        check for an editorial outcome.
      </p>
      <Card title="Submitted capture">
        <DefinitionList
          items={[
            { term: "Submission ID", value: <code>{submission.id}</code> },
            { term: "Status", value: submission.status.replaceAll("-", " ") },
            { term: "Submitted", value: submission.submittedAt ?? "Not recorded" },
            {
              term: "Source selection",
              value: submission.sourceKind?.replaceAll("-", " ") ?? "Not recorded",
            },
            { term: "Tag", value: submission.releaseTag ?? "No tag selected" },
            {
              term: "Captured commit",
              value: submission.commitSha ? <code>{submission.commitSha}</code> : "Not recorded",
            },
          ]}
        />
      </Card>
      <Card title="Next step">
        <p>{nextStep(submission.status)}</p>
        <p>
          Submission and archive acceptance are separate from peer review, scientific correctness
          and certification.
        </p>
        {submission.publicReviewHref ? (
          <p>
            <Link href={submission.publicReviewHref}>Open the accepted exact review version</Link>
          </p>
        ) : null}
        <div className="btn-row">
          <Link href="/publications">Browse sources</Link>
          <Link href="/submit">Inspect another source</Link>
        </div>
      </Card>
    </article>
  );
}

function nextStep(status: string): string {
  switch (status) {
    case "automated-checks-failed":
      return "Your capture was submitted with checks requiring attention. An editor must review those checks before deciding whether to accept it.";
    case "accepted":
      return "An editor accepted this submission. An available public review version is linked below; research objects are available through Sources.";
    case "changes-requested":
      return "An editor requested changes. Follow the feedback you receive through the editorial workflow; this status page does not create or submit a revision.";
    case "rejected":
      return "An editor rejected this submission. The original submitted capture remains recorded.";
    case "superseded":
      return "A later submission superseded this one. This page continues to identify the original submitted capture.";
    default:
      return "Your submission is awaiting an editorial outcome. You do not need to submit this same capture again.";
  }
}
