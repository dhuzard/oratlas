"use client";

import { useState } from "react";

export function VerificationInitiateForm({
  publicationVersionId,
  protocols,
}: {
  publicationVersionId: string;
  protocols: { id: string; label: string }[];
}) {
  const [protocolId, setProtocolId] = useState(protocols[0]?.id ?? "");
  const [profile, setProfile] = useState<"full" | "blinded-scientific">("blinded-scientific");
  const [message, setMessage] = useState("");

  async function submit() {
    setMessage("Requesting…");
    const response = await fetch("/api/verification-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        verificationProtocolId: protocolId,
        subject: { type: "publication-version", publicationVersionId },
        inputProfile: profile,
        inputProfileVersion: "1.0.0",
        idempotencyKey: `editor-${publicationVersionId}-${protocolId}-${crypto.randomUUID()}`,
      }),
    });
    if (!response.ok) {
      setMessage(`Request failed (${response.status}).`);
      return;
    }
    const run = (await response.json()) as { id: string };
    window.location.assign(`/verifications/${run.id}`);
  }

  if (!protocols.length)
    return <p className="muted">No active publication verification protocol is configured.</p>;
  return (
    <div>
      <label>
        Protocol{" "}
        <select value={protocolId} onChange={(event) => setProtocolId(event.target.value)}>
          {protocols.map((protocol) => (
            <option key={protocol.id} value={protocol.id}>
              {protocol.label}
            </option>
          ))}
        </select>
      </label>{" "}
      <label>
        Input{" "}
        <select
          value={profile}
          onChange={(event) => setProfile(event.target.value as typeof profile)}
        >
          <option value="blinded-scientific">Blinded scientific (bias-reduced)</option>
          <option value="full">Full</option>
        </select>
      </label>{" "}
      <button type="button" className="btn" onClick={submit}>
        Request verification
      </button>
      {message ? <span className="muted"> {message}</span> : null}
    </div>
  );
}
