"use client";

import { useState } from "react";
import type { ConflictOfInterestStatus } from "@oratlas/contracts";
import type { ChallengeQueueItem } from "@/lib/challenges";

export function ChallengeQueuePanel({
  items,
  isAdministrator,
}: {
  items: ChallengeQueueItem[];
  isAdministrator: boolean;
}) {
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<Record<string, ConflictOfInterestStatus>>({});
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");

  async function mutate(path: string, payload: unknown) {
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
    window.location.reload();
  }

  if (items.length === 0) return <p className="muted">No active formal challenges in this page.</p>;
  return (
    <div>
      {items.map((item) => (
        <article className="card" key={item.id}>
          <p>
            <a href={item.challengeHref}>{item.subjectLabel}</a> ·{" "}
            {item.status.replaceAll("-", " ")}
          </p>
          <p className="muted">
            Filed {item.createdAt.slice(0, 10)} · immutable challenge {item.id}
          </p>
          <div className="btn-row">
            {item.contentStatus === "visible" ? (
              <button
                type="button"
                onClick={() =>
                  mutate(`/api/challenges/${encodeURIComponent(item.id)}/moderation`, {
                    expectedContentRevision: item.contentRevision,
                  })
                }
              >
                Remove challenge text
              </button>
            ) : (
              <span className="muted">Challenge text removed</span>
            )}
            {item.response?.contentStatus === "visible" ? (
              <button
                type="button"
                onClick={() =>
                  mutate(
                    `/api/challenge-responses/${encodeURIComponent(item.response!.id)}/moderation`,
                    { expectedContentRevision: item.response!.contentRevision },
                  )
                }
              >
                Remove response text
              </button>
            ) : null}
          </div>
          {item.status === "author-responded" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement;
                void mutate(`/api/challenges/${encodeURIComponent(item.id)}/transitions`, {
                  expectedRevision: item.revision,
                  toStatus: submitter.value,
                  rationale: rationales[item.id] ?? "",
                  conflictOfInterest: { status: conflicts[item.id] ?? "not-provided" },
                  ...(overrides[item.id] ? { administratorOverride: true } : {}),
                });
              }}
            >
              <label>
                Editorial rationale (private)
                <textarea
                  required
                  maxLength={5_000}
                  value={rationales[item.id] ?? ""}
                  onChange={(event) =>
                    setRationales((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                />
              </label>
              <label>
                Conflict-of-interest declaration (public, immutable)
                <select
                  value={conflicts[item.id] ?? "not-provided"}
                  onChange={(event) =>
                    setConflicts((current) => ({
                      ...current,
                      [item.id]: event.target.value as ConflictOfInterestStatus,
                    }))
                  }
                >
                  <option value="none-declared">None declared</option>
                  <option value="conflict-declared">Conflict declared</option>
                  <option value="not-provided">Not provided</option>
                </select>
              </label>
              {isAdministrator ? (
                <label>
                  <input
                    type="checkbox"
                    checked={overrides[item.id] ?? false}
                    onChange={(event) =>
                      setOverrides((current) => ({
                        ...current,
                        [item.id]: event.target.checked,
                      }))
                    }
                  />{" "}
                  Public audited administrator override for direct self-involvement
                </label>
              ) : null}
              <button type="submit" value="resolved">
                Resolve
              </button>{" "}
              <button type="submit" value="dismissed">
                Dismiss
              </button>
            </form>
          ) : null}
        </article>
      ))}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
