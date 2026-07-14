"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson as post } from "@/lib/client-post";

export function ReportForm({ roundId }: { roundId: string }) {
  const router = useRouter();
  const [summary, setSummary] = useState("");
  const [recommendation, setRecommendation] = useState("minor-revision");
  const [coiStatement, setCoiStatement] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        const error = await post(`/api/editorial/rounds/${roundId}/reports`, {
          recommendation,
          body: { schemaVersion: "1.0.0", summary },
          coiStatement: coiStatement || undefined,
        });
        setBusy(false);
        if (error) setMessage(error);
        else router.refresh();
      }}
    >
      <h3>Submit a formal review report</h3>
      <p className="muted">
        Reports are public, attributable and immutable once submitted (minimum 50 characters).
      </p>
      <textarea
        required
        minLength={50}
        rows={6}
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        placeholder="Review summary"
        style={{ width: "100%" }}
      />
      <div className="btn-row" style={{ marginTop: "0.4rem" }}>
        <select value={recommendation} onChange={(event) => setRecommendation(event.target.value)}>
          <option value="accept">accept</option>
          <option value="minor-revision">minor revision</option>
          <option value="major-revision">major revision</option>
          <option value="reject">reject</option>
        </select>
        <input
          type="text"
          value={coiStatement}
          onChange={(event) => setCoiStatement(event.target.value)}
          placeholder="Competing-interest statement (optional)"
          style={{ minWidth: "18rem" }}
        />
        <button className="btn" disabled={busy} type="submit">
          Submit report
        </button>
      </div>
      {message ? <p className="form-error">{message}</p> : null}
    </form>
  );
}

export function ResponseForm({ roundId }: { roundId: string }) {
  const router = useRouter();
  const [response, setResponse] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        const error = await post(`/api/editorial/rounds/${roundId}/responses`, {
          body: { schemaVersion: "1.0.0", response },
        });
        setBusy(false);
        if (error) setMessage(error);
        else router.refresh();
      }}
    >
      <h3>Author response</h3>
      <textarea
        required
        minLength={20}
        rows={4}
        value={response}
        onChange={(event) => setResponse(event.target.value)}
        placeholder="Respond to the reviews in this round"
        style={{ width: "100%" }}
      />
      <div className="btn-row" style={{ marginTop: "0.4rem" }}>
        <button className="btn" disabled={busy} type="submit">
          Submit response
        </button>
      </div>
      {message ? <p className="form-error">{message}</p> : null}
    </form>
  );
}

export function RoundDecisionForm({ roundId }: { roundId: string }) {
  const router = useRouter();
  const [letter, setLetter] = useState("");
  const [decision, setDecision] = useState("request-changes");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        const error = await post(`/api/editorial/rounds/${roundId}/decision`, {
          decision,
          letter: { schemaVersion: "1.0.0", letter },
        });
        setBusy(false);
        if (error) setMessage(error);
        else router.refresh();
      }}
    >
      <h3>Issue decision letter</h3>
      <p className="muted">
        The letter closes this round and applies the archive decision. Acceptance atomically
        publishes the exact submitted snapshot.
      </p>
      <textarea
        required
        minLength={20}
        rows={4}
        value={letter}
        onChange={(event) => setLetter(event.target.value)}
        placeholder="Decision letter"
        style={{ width: "100%" }}
      />
      <div className="btn-row" style={{ marginTop: "0.4rem" }}>
        <select value={decision} onChange={(event) => setDecision(event.target.value)}>
          <option value="accept">accept</option>
          <option value="request-changes">request changes</option>
          <option value="reject">reject</option>
        </select>
        <button className="btn" disabled={busy} type="submit">
          Issue decision
        </button>
      </div>
      {message ? <p className="form-error">{message}</p> : null}
    </form>
  );
}
