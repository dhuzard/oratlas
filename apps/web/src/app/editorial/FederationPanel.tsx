"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client-post";

interface FederationItem {
  id: string;
  activityId: string;
  pattern: string;
  actorUri?: string;
  objectUri: string;
  contextUri?: string;
  originUri: string;
  status: string;
  createdAt: string;
}

/** Human gate for untrusted COAR Notify requests; receipt never auto-publishes a review. */
export function FederationPanel({ notifications }: { notifications: FederationItem[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = notifications.filter((item) => item.status === "pending");

  async function resolve(item: FederationItem, decision: "accepted" | "rejected") {
    setBusy(true);
    setMessage(null);
    const error = await postJson(`/api/editorial/federation/${item.id}/resolve`, {
      decision,
      note: notes[item.id] ?? "",
    });
    setBusy(false);
    if (error) setMessage(error);
    else router.refresh();
  }

  return (
    <div>
      <p className="muted">
        COAR Notify review requests are preserved as untrusted, immutable messages. Accepting a
        request records coordination intent only; it never accepts or publishes scholarly content.
      </p>
      <h3>Pending notifications ({pending.length})</h3>
      {pending.length === 0 ? (
        <p className="muted">No federated review requests await triage.</p>
      ) : (
        pending.map((item) => (
          <div className="claim-card" key={item.id}>
            <p>
              <strong>{item.pattern.replaceAll("-", " ")}</strong> · {item.createdAt.slice(0, 10)}
            </p>
            <p className="mono" style={{ overflowWrap: "anywhere" }}>
              {item.objectUri}
            </p>
            <p className="muted" style={{ overflowWrap: "anywhere" }}>
              actor {item.actorUri ?? "not supplied"} · origin {item.originUri}
            </p>
            <div className="btn-row">
              <input
                type="text"
                value={notes[item.id] ?? ""}
                onChange={(event) =>
                  setNotes((current) => ({ ...current, [item.id]: event.target.value }))
                }
                placeholder="Editorial resolution note (≥10 characters)"
                style={{ minWidth: "24rem" }}
              />
              <button
                className="btn"
                disabled={busy}
                onClick={() => void resolve(item, "accepted")}
              >
                Accept request
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void resolve(item, "rejected")}
              >
                Reject request
              </button>
            </div>
          </div>
        ))
      )}
      {message ? <p className="form-error">{message}</p> : null}
    </div>
  );
}
