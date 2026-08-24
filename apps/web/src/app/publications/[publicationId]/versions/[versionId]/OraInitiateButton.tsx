"use client";

import { useState } from "react";

export function OraInitiateButton({
  publicationVersionId,
  available,
}: {
  publicationVersionId: string;
  available: boolean;
}) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState(
    available ? "" : "Real ORA evaluator configuration is unavailable.",
  );
  async function initiate() {
    setState("running");
    try {
      const response = await fetch("/api/editorial/ora-certifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicationVersionId }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        replayed?: boolean;
        outcome?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        setState("error");
        setMessage(body.error?.message ?? "ORA certification could not be started.");
        return;
      }
      if (typeof body.outcome !== "string") {
        throw new Error("ORA certification returned an invalid response.");
      }
      setState("done");
      setMessage(
        `${body.replayed ? "Existing" : "New"} ORA result: ${body.outcome}. Reload to inspect it.`,
      );
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "ORA certification could not be started.",
      );
    }
  }
  return (
    <div>
      <button
        className="btn"
        type="button"
        disabled={!available || state === "running" || state === "done"}
        onClick={initiate}
      >
        {state === "running" ? "Assessing frozen packet…" : "Initiate ORA Pilot assessment"}
      </button>
      {message ? <p className={state === "error" ? "error" : "muted"}>{message}</p> : null}
    </div>
  );
}
