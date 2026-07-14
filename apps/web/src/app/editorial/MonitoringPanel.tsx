"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson as post } from "@/lib/client-post";

interface ProposalItem {
  id: string;
  citationStatus: string;
  workAlias: string;
  rationale: string;
  claimText: string;
  passportPath: string;
  createdAt: string;
}

/** Evidence monitoring queue: register work-status signals, resolve proposals. */
export function MonitoringPanel({ proposals }: { proposals: ProposalItem[] }) {
  const router = useRouter();
  const [doi, setDoi] = useState("");
  const [status, setStatus] = useState("retracted");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setMessage(null);
    const error = await action();
    setBusy(false);
    if (error) setMessage(error);
    else router.refresh();
  }

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(() =>
            post("/api/monitoring/citation-status", {
              doi,
              status,
              source,
              note: note || undefined,
            }),
          );
        }}
      >
        <p className="muted">
          Register an observed change to a cited work. Affected claims are identified
          deterministically and each opens a human-reviewable proposal.
        </p>
        <div className="btn-row">
          <input
            required
            type="text"
            value={doi}
            onChange={(event) => setDoi(event.target.value)}
            placeholder="DOI of the cited work"
            style={{ minWidth: "18rem" }}
          />
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="retracted">retracted</option>
            <option value="corrected">corrected</option>
            <option value="expression-of-concern">expression of concern</option>
            <option value="new-evidence">new evidence</option>
          </select>
          <input
            required
            type="text"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="Signal source (e.g. publisher notice)"
            style={{ minWidth: "14rem" }}
          />
          <button className="btn" disabled={busy} type="submit">
            Register signal
          </button>
        </div>
        <input
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Note (optional)"
          style={{ width: "100%", marginTop: "0.4rem" }}
        />
      </form>

      <h3 style={{ marginTop: "0.8rem" }}>Open update proposals ({proposals.length})</h3>
      {proposals.length === 0 ? (
        <p className="muted">No open proposals.</p>
      ) : (
        proposals.map((proposal) => (
          <div className="claim-card" key={proposal.id}>
            <p>
              <strong>{proposal.citationStatus}</strong>{" "}
              <span className="mono muted">{proposal.workAlias}</span> ·{" "}
              {proposal.createdAt.slice(0, 10)}
            </p>
            <p>{proposal.rationale}</p>
            <p className="muted">
              Claim: {proposal.claimText.slice(0, 160)}
              {proposal.claimText.length > 160 ? "…" : ""}{" "}
              <Link href={proposal.passportPath}>passport</Link>
            </p>
            <div className="btn-row">
              <input
                type="text"
                value={resolutionNotes[proposal.id] ?? ""}
                onChange={(event) =>
                  setResolutionNotes((prev) => ({ ...prev, [proposal.id]: event.target.value }))
                }
                placeholder="Resolution note (≥10 characters)"
                style={{ minWidth: "20rem" }}
              />
              {(["resolved-updated", "resolved-no-action", "dismissed"] as const).map(
                (resolution) => (
                  <button
                    key={resolution}
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        post(`/api/monitoring/proposals/${proposal.id}/resolve`, {
                          resolution,
                          note: resolutionNotes[proposal.id] ?? "",
                        }),
                      )
                    }
                  >
                    {resolution.replace(/-/g, " ")}
                  </button>
                ),
              )}
            </div>
          </div>
        ))
      )}
      {message ? <p className="form-error">{message}</p> : null}
    </div>
  );
}
