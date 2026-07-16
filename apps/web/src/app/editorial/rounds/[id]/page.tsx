import { notFound, redirect } from "next/navigation";
import { type Metadata } from "next";
import { Badge, Card, Notice, StatusPill } from "@oratlas/ui";
import { getCurrentUser } from "@/lib/auth";
import { getRoundDetail } from "@/lib/editorial-lifecycle";
import { ReportForm, ResponseForm, RoundDecisionForm } from "./RoundForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review round" };

/**
 * One formal review round. Reports, responses and the decision letter are
 * public and attributable; action forms appear only for eligible viewers.
 */
export default async function RoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const round = await getRoundDetail(id, user.id);
  if (!round) notFound();

  const canReport =
    round.status === "open" &&
    !round.viewerIsSubmitter &&
    !round.viewerIsAssignedEditor &&
    !round.viewerHasReported;
  const canRespond = round.status === "open" && round.viewerIsSubmitter;
  const canDecide = round.status === "open" && round.viewerIsActiveEditor;

  return (
    <article>
      <h1>
        Review round {round.roundNumber} — {round.submissionTitle}
      </h1>
      <div className="btn-row" style={{ marginBottom: "0.5rem" }}>
        <StatusPill status={round.status} />
        <span className="muted">
          submission {round.submissionStatus} · submitter @{round.submitterLogin}
        </span>
      </div>
      <Notice tone="info" title="Open review">
        This process history is public and immutable. Formal peer review is distinct from archive
        acceptance: it judges the scholarship, not the structural checks.
      </Notice>

      <Card title={`Review reports (${round.reports.length})`}>
        {round.reports.length === 0 ? (
          <p className="muted">No reports yet.</p>
        ) : (
          round.reports.map((report, index) => (
            <div className="claim-card" key={index}>
              <div className="btn-row">
                <Badge>{report.recommendation}</Badge>
                <span>
                  @{report.reviewerLogin}
                  {report.reviewerOrcid ? (
                    report.orcidVerified ? (
                      <a className="mono" href={`https://orcid.org/${report.reviewerOrcid}`}>
                        {" "}
                        ({report.reviewerOrcid})
                      </a>
                    ) : (
                      <span className="mono"> ({report.reviewerOrcid}, unverified)</span>
                    )
                  ) : null}
                </span>
                <span className="muted">{report.submittedAt.slice(0, 10)}</span>
              </div>
              <p>{report.body.summary}</p>
              {report.body.strengths.length > 0 ? (
                <p className="muted">Strengths: {report.body.strengths.join(" · ")}</p>
              ) : null}
              {report.body.weaknesses.length > 0 ? (
                <p className="muted">Weaknesses: {report.body.weaknesses.join(" · ")}</p>
              ) : null}
              {report.body.questions.length > 0 ? (
                <p className="muted">Questions: {report.body.questions.join(" · ")}</p>
              ) : null}
              {report.coiStatement ? (
                <p className="muted">Competing interests: {report.coiStatement}</p>
              ) : null}
              <p className="mono muted" style={{ overflowWrap: "anywhere", fontSize: "0.8rem" }}>
                report SHA-256 {report.bodyHash}
              </p>
            </div>
          ))
        )}
      </Card>

      <Card title={`Author responses (${round.responses.length})`}>
        {round.responses.length === 0 ? (
          <p className="muted">No responses yet.</p>
        ) : (
          round.responses.map((response, index) => (
            <div className="claim-card" key={index}>
              <p>{response.body.response}</p>
              <p className="muted">
                @{response.authorLogin} · {response.submittedAt.slice(0, 10)}
              </p>
            </div>
          ))
        )}
      </Card>

      {round.decision ? (
        <Card title="Decision letter">
          <div className="btn-row">
            <Badge tone={round.decision.decision === "reject" ? "warning" : "neutral"}>
              {round.decision.decision}
            </Badge>
            <span className="muted">
              @{round.decision.editorLogin} · {round.decision.issuedAt.slice(0, 10)}
            </span>
          </div>
          <p>{round.decision.letter.letter}</p>
        </Card>
      ) : null}

      {canReport ? (
        <Card>
          <ReportForm roundId={round.roundId} />
        </Card>
      ) : null}
      {canRespond ? (
        <Card>
          <ResponseForm roundId={round.roundId} />
        </Card>
      ) : null}
      {canDecide ? (
        <Card>
          <RoundDecisionForm
            roundId={round.roundId}
            nodeCandidates={round.nodeCandidates}
            nodeOnly={round.nodeOnly}
          />
        </Card>
      ) : null}
    </article>
  );
}
