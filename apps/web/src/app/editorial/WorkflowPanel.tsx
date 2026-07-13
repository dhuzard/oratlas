"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson as post } from "@/lib/client-post";

interface WorkflowProps {
  submissionId: string;
  viewerId: string;
  assignments: Array<{
    id: string;
    editorId: string;
    editorLogin: string;
    status: string;
    coiDeclared: boolean;
  }>;
  rounds: Array<{
    id: string;
    roundNumber: number;
    status: string;
    reportCount: number;
    responseCount: number;
    decision?: string;
  }>;
}

/** Formal-review workflow actions for one pending submission. */
export function WorkflowPanel({ submissionId, viewerId, assignments, rounds }: WorkflowProps) {
  const router = useRouter();
  const [coiDeclared, setCoiDeclared] = useState(false);
  const [coiStatement, setCoiStatement] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const viewerAssignment = assignments.find((assignment) => assignment.editorId === viewerId);
  const hasOpenRound = rounds.some((round) => round.status === "open");

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setMessage(null);
    const error = await action();
    setBusy(false);
    if (error) setMessage(error);
    else router.refresh();
  }

  return (
    <div className="workflow-panel" style={{ marginTop: "0.6rem" }}>
      <p style={{ marginBottom: "0.3rem" }}>
        <strong>Formal review</strong>{" "}
        <span className="muted">
          {assignments.length === 0
            ? "— no editor assigned"
            : assignments
                .map((assignment) => `@${assignment.editorLogin} (${assignment.status})`)
                .join(", ")}
        </span>
      </p>
      {rounds.length > 0 ? (
        <ul style={{ marginBottom: "0.4rem" }}>
          {rounds.map((round) => (
            <li key={round.id}>
              <Link href={`/editorial/rounds/${round.id}`}>Round {round.roundNumber}</Link> —{" "}
              {round.status}
              {round.decision ? ` (${round.decision})` : ""} · {round.reportCount} report(s) ·{" "}
              {round.responseCount} response(s)
            </li>
          ))}
        </ul>
      ) : null}
      <div className="btn-row">
        {!viewerAssignment ? (
          <>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
              <input
                type="checkbox"
                checked={coiDeclared}
                onChange={(event) => setCoiDeclared(event.target.checked)}
              />
              I declare a conflict of interest
            </label>
            {coiDeclared ? (
              <input
                type="text"
                placeholder="Conflict statement (required)"
                value={coiStatement}
                onChange={(event) => setCoiStatement(event.target.value)}
                style={{ minWidth: "18rem" }}
              />
            ) : null}
            <button
              className="btn btn-secondary"
              disabled={busy}
              onClick={() =>
                run(() =>
                  post("/api/editorial/assignments", {
                    submissionId,
                    editorId: viewerId,
                    coi: { declared: coiDeclared, statement: coiStatement },
                  }),
                )
              }
            >
              Assign myself
            </button>
          </>
        ) : null}
        {viewerAssignment?.status === "active" && !hasOpenRound ? (
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => run(() => post("/api/editorial/rounds", { submissionId }))}
          >
            Open review round
          </button>
        ) : null}
      </div>
      {message ? <p className="form-error">{message}</p> : null}
    </div>
  );
}
