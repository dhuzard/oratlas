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
}: {
  initial: ChallengeList;
  subjects: ChallengeSubjectOption[];
  canFile: boolean;
}) {
  const [list, setList] = useState(initial);
  const [subjectIndex, setSubjectIndex] = useState(0);
  const [selectedGrounds, setSelectedGrounds] = useState<ChallengeGrounds>("entailment");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");

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

  return (
    <section
      id="formal-challenges"
      data-register="formal-challenge"
      aria-labelledby="formal-challenges-title"
    >
      <h2 id="formal-challenges-title">Formal challenges</h2>
      <p className="muted">
        Attributed objections to exact immutable subjects. Challenges do not change claims,
        relations, assessments, or establish scientific truth.
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
              <p>{challenge.body}</p>
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
                      {transition.actorRoleSnapshot})
                      {transition.rationale ? ` — ${transition.rationale}` : ""}
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ol>
      )}
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
          {message ? <p role="status">{message}</p> : null}
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
