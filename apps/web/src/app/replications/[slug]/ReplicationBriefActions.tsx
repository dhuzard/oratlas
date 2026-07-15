"use client";

import { useState, type FormEvent } from "react";

export function ReplicationBriefActions({
  slug,
  status,
  revision,
  signedIn,
  isClaimant,
  isEditor,
}: {
  slug: string;
  status: string;
  revision: number;
  signedIn: boolean;
  isClaimant: boolean;
  isEditor: boolean;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function transition(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/replications/${encodeURIComponent(slug)}/transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, expectedRevision: revision }),
      });
      const result = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Replication action failed.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Replication action failed.");
      setBusy(false);
    }
  }

  function claim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void transition({
      action: "claim",
      protocolUrl: String(data.get("protocolUrl") ?? ""),
      note: String(data.get("note") ?? ""),
    });
  }

  function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void transition({
      action: "complete",
      completionUrl: String(data.get("completionUrl") ?? ""),
      summary: String(data.get("summary") ?? ""),
    });
  }

  function withdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void transition({ action: "withdraw", reason: String(data.get("reason") ?? "") });
  }

  return (
    <section aria-labelledby="brief-actions-heading">
      <h2 id="brief-actions-heading">Actions</h2>
      {!signedIn && status === "open" ? (
        <p>
          <a href="/signin">Sign in</a> to claim this brief with a public protocol.
        </p>
      ) : null}
      {signedIn && status === "open" ? (
        <form onSubmit={claim} className="card">
          <h3>Claim this brief</h3>
          <p className="muted">
            Claiming reserves this brief for your account; it is not an endorsement or award and
            does not promise an outcome.
          </p>
          <div className="field">
            <label htmlFor="protocolUrl">Public registered protocol URL</label>
            <input id="protocolUrl" name="protocolUrl" type="url" required maxLength={2000} />
          </div>
          <div className="field">
            <label htmlFor="claimNote">Public claim note</label>
            <textarea id="claimNote" name="note" required minLength={20} maxLength={2000} />
            <p className="muted">
              This note is published beside your account name. Do not include confidential contact,
              participant, or protocol information.
            </p>
          </div>
          <button className="btn" type="submit" disabled={busy}>
            Claim brief
          </button>
        </form>
      ) : null}
      {signedIn && status === "claimed" && isClaimant ? (
        <form onSubmit={complete} className="card">
          <h3>Record completion</h3>
          <p className="muted">
            Completion records a linked research output only. Atlas does not classify its result as
            successful, failed, confirmatory, or true.
          </p>
          <div className="field">
            <label htmlFor="completionUrl">Public completion record URL</label>
            <input id="completionUrl" name="completionUrl" type="url" required maxLength={2000} />
          </div>
          <div className="field">
            <label htmlFor="completionSummary">Neutral completion summary</label>
            <textarea
              id="completionSummary"
              name="summary"
              required
              minLength={50}
              maxLength={5000}
            />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            Record completion
          </button>
        </form>
      ) : null}
      {isEditor && ["open", "claimed"].includes(status) ? (
        <form onSubmit={withdraw} className="card">
          <h3>Editorial withdrawal</h3>
          <div className="field">
            <label htmlFor="withdrawReason">Public reason</label>
            <textarea id="withdrawReason" name="reason" required minLength={20} maxLength={5000} />
          </div>
          <button className="btn btn-secondary" type="submit" disabled={busy}>
            Withdraw brief
          </button>
        </form>
      ) : null}
      {message ? (
        <p role="alert" className="notice notice-error">
          {message}
        </p>
      ) : null}
    </section>
  );
}
