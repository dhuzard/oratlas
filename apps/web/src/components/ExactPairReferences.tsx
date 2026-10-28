"use client";

import { useState } from "react";

export function ExactPairReferences({ href, references }: { href: string; references: string }) {
  const [status, setStatus] = useState("");
  const [manualCopy, setManualCopy] = useState<string | null>(null);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setManualCopy(null);
      setStatus("Copied exact references.");
    } catch {
      setManualCopy(value);
      setStatus("Copy was unavailable. Select and copy the references below.");
    }
  }

  return (
    <section aria-labelledby="pair-references-title">
      <h2 id="pair-references-title">Reuse this exact pair</h2>
      <p>
        These references preserve both occurrence identities and versions. Reopening them does not
        select a newer version or confirm a relationship.
      </p>
      <div className="btn-row">
        <a href={href}>Reopen exact pair</a>
        <button
          className="btn btn-secondary"
          onClick={() => copy(new URL(href, window.location.origin).href)}
        >
          Copy exact pair link
        </button>
        <button className="btn btn-secondary" onClick={() => copy(references)}>
          Copy exact references
        </button>
      </div>
      <p role="status">{status}</p>
      {manualCopy !== null ? (
        <div className="field">
          <label htmlFor="manual-pair-copy">Select and copy exact references</label>
          <textarea
            id="manual-pair-copy"
            readOnly
            value={manualCopy}
            rows={5}
            onFocus={(event) => event.currentTarget.select()}
            style={{ width: "100%", maxWidth: "100%" }}
          />
        </div>
      ) : null}
      <details>
        <summary>Exact occurrence references</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{references}</pre>
      </details>
    </section>
  );
}
