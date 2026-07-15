"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  getOrCreateDraftRequestIdentity,
  settleDraftRequestIdentity,
  type DraftRequestIdentity,
  type DraftRequestOutcome,
} from "./draft-idempotency";

interface EditorialBrief {
  slug: string;
  title: string;
  status: string;
  revision: number;
  publishedAt?: string;
  claims: Array<{ reviewVersionId: string; localClaimId: string; text: string }>;
}

export function ReplicationBriefEditor({ briefs }: { briefs: EditorialBrief[] }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const draftRequestIdentity = useRef<DraftRequestIdentity | null>(null);

  async function request(url: string, body: unknown): Promise<DraftRequestOutcome> {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setMessage(result.error?.message ?? "Replication action failed.");
        setBusy(false);
        return { kind: "http-error", status: response.status };
      }
      window.location.reload();
      return { kind: "success" };
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Replication action failed.");
      setBusy(false);
      return { kind: "transport-error" };
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const claims = String(data.get("claims") ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("|");
        return {
          reviewVersionId: separator >= 0 ? line.slice(0, separator).trim() : "",
          localClaimId: separator >= 0 ? line.slice(separator + 1).trim() : "",
        };
      });
    const scope = Object.fromEntries(
      ["population", "model", "intervention", "outcome", "method", "notes"]
        .map((key) => [key, String(data.get(key) ?? "").trim()] as const)
        .filter(([, value]) => value),
    );
    const payload = {
      slug: String(data.get("slug") ?? "").trim(),
      title: String(data.get("title") ?? "").trim(),
      summary: String(data.get("summary") ?? "").trim(),
      scope,
      expectedInformationGain: String(data.get("expectedInformationGain") ?? "").trim(),
      effortBand: String(data.get("effortBand") ?? "").trim(),
      protocolUrl: String(data.get("protocolUrl") ?? "").trim() || undefined,
      citationUrls: String(data.get("citationUrls") ?? "")
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean),
      claims,
    };
    const identity = getOrCreateDraftRequestIdentity(
      draftRequestIdentity.current,
      payload,
      crypto.randomUUID.bind(crypto),
    );
    draftRequestIdentity.current = identity;
    void request("/api/replications", { idempotencyKey: identity.key, ...payload }).then(
      (outcome) => {
        draftRequestIdentity.current = settleDraftRequestIdentity(identity, outcome);
      },
    );
  }

  function transition(slug: string, revision: number, body: Record<string, unknown>) {
    void request(`/api/replications/${encodeURIComponent(slug)}/transitions`, {
      ...body,
      expectedRevision: revision,
    });
  }

  return (
    <div>
      <form
        onSubmit={create}
        onReset={() => {
          draftRequestIdentity.current = null;
          setMessage("");
        }}
        className="card"
      >
        <h2>Register a draft brief</h2>
        <p className="muted">
          Saving creates a private editorial draft only. Publication always requires a separate
          attributable editor action.
        </p>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="briefSlug">Slug</label>
            <input id="briefSlug" name="slug" required minLength={3} maxLength={100} />
          </div>
          <div className="field">
            <label htmlFor="briefEffort">Effort band</label>
            <select id="briefEffort" name="effortBand" defaultValue="medium">
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
              <option value="consortium">Consortium</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="briefTitle">Title</label>
          <input id="briefTitle" name="title" required minLength={10} maxLength={300} />
        </div>
        <div className="field">
          <label htmlFor="briefSummary">Neutral summary</label>
          <textarea id="briefSummary" name="summary" required minLength={50} maxLength={5000} />
        </div>
        <fieldset>
          <legend>Scope</legend>
          <div className="grid grid-2">
            {(["population", "model", "intervention", "outcome", "method"] as const).map(
              (field) => (
                <div className="field" key={field}>
                  <label htmlFor={`brief-${field}`}>{field}</label>
                  <input id={`brief-${field}`} name={field} maxLength={300} />
                </div>
              ),
            )}
          </div>
          <div className="field">
            <label htmlFor="briefScopeNotes">Scope notes</label>
            <textarea id="briefScopeNotes" name="notes" minLength={20} maxLength={2000} />
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="briefInformationGain">Expected information gain rationale</label>
          <textarea
            id="briefInformationGain"
            name="expectedInformationGain"
            required
            minLength={50}
            maxLength={5000}
          />
        </div>
        <div className="field">
          <label htmlFor="briefProtocol">Protocol URL (optional until claimed)</label>
          <input id="briefProtocol" name="protocolUrl" type="url" maxLength={2000} />
        </div>
        <div className="field">
          <label htmlFor="briefCitations">Citation URLs (one HTTPS URL per line)</label>
          <textarea id="briefCitations" name="citationUrls" required />
        </div>
        <div className="field">
          <label htmlFor="briefClaims">
            Claim references (one <span className="mono">reviewVersionId|localClaimId</span> per
            line)
          </label>
          <textarea id="briefClaims" name="claims" required />
        </div>
        <div className="btn-row">
          <button className="btn" type="submit" disabled={busy}>
            Save private draft
          </button>
          <button className="btn btn-secondary" type="reset" disabled={busy}>
            Reset draft
          </button>
        </div>
      </form>

      <h2>Registered briefs ({briefs.length})</h2>
      {briefs.map((brief) => (
        <article className="card" key={brief.slug}>
          <div className="btn-row">
            <span className="status-pill">{brief.status}</span>
            <span className="mono">revision {brief.revision}</span>
            {brief.publishedAt ? <a href={`/replications/${brief.slug}`}>Public detail</a> : null}
          </div>
          <h3>{brief.title}</h3>
          <ul>
            {brief.claims.map((claim) => (
              <li key={`${claim.reviewVersionId}:${claim.localClaimId}`}>
                <span className="mono">
                  {claim.reviewVersionId}|{claim.localClaimId}
                </span>{" "}
                — {claim.text}
              </li>
            ))}
          </ul>
          {brief.status === "draft" ? (
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => transition(brief.slug, brief.revision, { action: "publish" })}
            >
              Publish as human editor
            </button>
          ) : null}
          {["draft", "open", "claimed"].includes(brief.status) ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                transition(brief.slug, brief.revision, {
                  action: "withdraw",
                  reason: String(data.get("reason") ?? ""),
                });
              }}
              style={{ marginTop: "1rem" }}
            >
              <div className="field">
                <label htmlFor={`withdraw-${brief.slug}`}>Public/editorial withdrawal reason</label>
                <textarea
                  id={`withdraw-${brief.slug}`}
                  name="reason"
                  required
                  minLength={20}
                  maxLength={5000}
                />
              </div>
              <button className="btn btn-secondary" type="submit" disabled={busy}>
                Withdraw
              </button>
            </form>
          ) : null}
        </article>
      ))}
      {message ? (
        <p role="alert" className="notice notice-error">
          {message}
        </p>
      ) : null}
    </div>
  );
}
