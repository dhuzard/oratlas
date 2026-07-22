"use client";

import { useState } from "react";
import type { ChallengeList, ChallengeGrounds, ChallengeSubjectInput } from "@oratlas/contracts";
import type { ChallengeSubjectOption } from "@/lib/challenges";

const grounds: Array<{ value: ChallengeGrounds; label: string }> = [
  { value: "entailment", label: "Entailment" },
  { value: "source-access", label: "Source access" },
  { value: "methodology", label: "Methodology" },
  { value: "identity", label: "Identity" },
  { value: "other", label: "Other" },
];

export function ChallengesSection({
  initial,
  subjects,
  canFile,
  viewer,
}: {
  initial: ChallengeList;
  subjects: ChallengeSubjectOption[];
  canFile: boolean;
  viewer: {
    githubLogin: string;
    isContributor: boolean;
    canResolve: boolean;
  } | null;
}) {
  const [list, setList] = useState(initial);
  const [subjectIndex, setSubjectIndex] = useState(0);
  const [selectedGrounds, setSelectedGrounds] = useState<ChallengeGrounds>("entailment");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [rationales, setRationales] = useState<Record<string, string>>({});

  async function refresh() {
    const response = await fetch(
      `/api/reviews/${encodeURIComponent(list.reviewSlug)}/versions/${encodeURIComponent(list.reviewVersionId)}/challenges`,
    );
    if (response.ok) setList((await response.json()) as ChallengeList);
  }

  async function fileChallenge(event: React.FormEvent) {
    event.preventDefault();
    const selected = subjects[subjectIndex];
    if (!selected) return;
    setMessage("Filing…");
    const response = await fetch(
      `/api/reviews/${encodeURIComponent(list.reviewSlug)}/versions/${encodeURIComponent(list.reviewVersionId)}/challenges`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewVersionId: list.reviewVersionId,
          subject: selected.subject satisfies ChallengeSubjectInput,
          canonicalSubjectHash: selected.canonicalSubjectHash,
          grounds: selectedGrounds,
          body,
        }),
      },
    );
    const payload = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) {
      setMessage(payload.error?.message ?? "Challenge filing failed.");
      return;
    }
    setBody("");
    setMessage("Challenge filed.");
    await refresh();
  }

  async function mutate(path: string, payload: unknown, success: string) {
    setMessage("Saving…");
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) {
      setMessage(result.error?.message ?? "Challenge action failed.");
      return;
    }
    setMessage(success);
    await refresh();
  }

  return (
    <section
      id="formal-challenges"
      data-register="formal-challenge"
      aria-labelledby="formal-challenges-title"
    >
      <h2 id="formal-challenges-title">Formal challenges</h2>
      <p className="muted">
        Unlike open discussion, a challenge is an attributed, immutable formal objection to an exact
        subject. Filing one does not change claims, relations, TRUST assessments, editorial
        decisions, the archived review, or establish scientific truth.
      </p>
      {list.challenges.length === 0 ? (
        <p className="muted">No formal challenges have been filed for this version.</p>
      ) : (
        <ol>
          {list.challenges.map((challenge) => (
            <li key={challenge.id} id={`challenge-${challenge.id}`}>
              <p>
                <strong>{challenge.grounds.replace(/-/g, " ")}</strong> ·{" "}
                <span>{challenge.status.replace(/-/g, " ")}</span>
              </p>
              {challenge.contentStatus === "removed" ? (
                <p className="muted">[challenge text removed]</p>
              ) : (
                <p>{challenge.body}</p>
              )}
              <p className="muted">
                Filed by @{challenge.challenger.githubLogin} against{" "}
                <a href={challenge.subjectHref}>{challenge.subjectLabel}</a> on{" "}
                {challenge.createdAt.slice(0, 10)}
              </p>
              <details>
                <summary>Lifecycle and immutable binding</summary>
                <p className="mono">subject sha256:{challenge.canonicalSubjectHash}</p>
                <p className="mono">filed content sha256:{challenge.filedContentHash}</p>
                <ol>
                  {challenge.transitions.map((transition) => (
                    <li key={transition.id}>
                      {transition.toStatus.replace(/-/g, " ")} · @{transition.actor.githubLogin} (
                      recorded {transition.createdAt.slice(0, 10)}) · COI:{" "}
                      {transition.conflictOfInterest.status.replace(/-/g, " ")}
                      {transition.administratorOverride
                        ? ` · administrator override by @${transition.administratorOverride.administrator.githubLogin}`
                        : ""}
                    </li>
                  ))}
                </ol>
              </details>
              {challenge.response ? (
                <div data-challenge-response={challenge.response.id}>
                  <h4>Contributor response</h4>
                  {challenge.response.contentStatus === "removed" ? (
                    <p className="muted">[response text removed]</p>
                  ) : (
                    <p>{challenge.response.body}</p>
                  )}
                  <p className="muted">
                    @{challenge.response.responder.githubLogin} · contributor of record ·{" "}
                    {challenge.response.createdAt.slice(0, 10)}
                  </p>
                  {viewer &&
                  challenge.response.contentStatus === "visible" &&
                  (viewer.canResolve ||
                    viewer.githubLogin.toLowerCase() ===
                      challenge.response.responder.githubLogin.toLowerCase()) ? (
                    <button
                      type="button"
                      onClick={() =>
                        mutate(
                          `/api/challenge-responses/${encodeURIComponent(challenge.response!.id)}/moderation`,
                          { expectedContentRevision: challenge.response!.contentRevision },
                          "Response removed; its tombstone remains public.",
                        )
                      }
                    >
                      Remove response text
                    </button>
                  ) : null}
                </div>
              ) : null}
              {viewer?.isContributor && challenge.status === "open" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void mutate(
                      `/api/challenges/${encodeURIComponent(challenge.id)}/responses`,
                      { expectedRevision: challenge.revision, body: responses[challenge.id] ?? "" },
                      "Contributor response recorded.",
                    );
                  }}
                >
                  <label>
                    Contributor response
                    <textarea
                      required
                      maxLength={10_000}
                      value={responses[challenge.id] ?? ""}
                      onChange={(event) =>
                        setResponses((current) => ({
                          ...current,
                          [challenge.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button type="submit">Respond as contributor of record</button>
                </form>
              ) : null}
              {viewer?.canResolve && challenge.status === "author-responded" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const submitter = (event.nativeEvent as SubmitEvent)
                      .submitter as HTMLButtonElement;
                    void mutate(
                      `/api/challenges/${encodeURIComponent(challenge.id)}/transitions`,
                      {
                        expectedRevision: challenge.revision,
                        toStatus: submitter.value,
                        rationale: rationales[challenge.id] ?? "",
                      },
                      "Editorial outcome recorded.",
                    );
                  }}
                >
                  <label>
                    Editorial rationale (private)
                    <textarea
                      required
                      maxLength={5_000}
                      value={rationales[challenge.id] ?? ""}
                      onChange={(event) =>
                        setRationales((current) => ({
                          ...current,
                          [challenge.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button type="submit" value="resolved">
                    Resolve
                  </button>{" "}
                  <button type="submit" value="dismissed">
                    Dismiss
                  </button>
                </form>
              ) : null}
              {viewer &&
              challenge.status === "author-responded" &&
              viewer.githubLogin.toLowerCase() ===
                challenge.challenger.githubLogin.toLowerCase() ? (
                <button
                  type="button"
                  onClick={() =>
                    mutate(
                      `/api/challenges/${encodeURIComponent(challenge.id)}/transitions`,
                      { expectedRevision: challenge.revision, toStatus: "withdrawn" },
                      "Challenge withdrawn.",
                    )
                  }
                >
                  Withdraw challenge
                </button>
              ) : null}
              {viewer &&
              challenge.contentStatus === "visible" &&
              (viewer.canResolve ||
                viewer.githubLogin.toLowerCase() ===
                  challenge.challenger.githubLogin.toLowerCase()) ? (
                <button
                  type="button"
                  onClick={() =>
                    mutate(
                      `/api/challenges/${encodeURIComponent(challenge.id)}/moderation`,
                      { expectedContentRevision: challenge.contentRevision },
                      "Challenge text removed; its tombstone remains public.",
                    )
                  }
                >
                  Remove challenge text
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {message ? <p role="status">{message}</p> : null}
      {canFile && subjects.length > 0 ? (
        <form onSubmit={fileChallenge}>
          <h3>File a formal challenge</h3>
          <label>
            Immutable subject
            <select
              value={subjectIndex}
              onChange={(event) => setSubjectIndex(Number(event.target.value))}
            >
              {subjects.map((subject, index) => (
                <option value={index} key={`${subject.subject.type}-${index}`}>
                  {subject.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Grounds
            <select
              value={selectedGrounds}
              onChange={(event) => setSelectedGrounds(event.target.value as ChallengeGrounds)}
            >
              {grounds.map((ground) => (
                <option value={ground.value} key={ground.value}>
                  {ground.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Objection
            <textarea
              required
              maxLength={10_000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <button type="submit">File challenge</button>
        </form>
      ) : canFile ? (
        <p className="muted">No challengeable subjects are available.</p>
      ) : (
        <p>
          <a href="/signin">Sign in to file a formal challenge.</a>
        </p>
      )}
    </section>
  );
}
