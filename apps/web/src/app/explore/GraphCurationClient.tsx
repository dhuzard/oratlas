"use client";

import { useState } from "react";
import type { KnowledgeLandscapeQuery } from "@oratlas/contracts";

export function GraphCurationClient({
  scope,
  initialQuestion,
}: {
  scope: KnowledgeLandscapeQuery;
  initialQuestion: string;
}) {
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function propose() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/editorial/graph-curation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question:
            initialQuestion || "Which scientifically meaningful graph relations are missing?",
          scope,
          llm: { provider, apiKey: apiKey.trim(), model: model.trim() || undefined },
        }),
      });
      const body = await response.json();
      if (!response.ok) setMessage(body?.error?.message ?? "Graph curation failed.");
      else if (body.error) setMessage(`No proposal created: ${body.error}`);
      else
        setMessage(
          `${body.created.length} private proposal${body.created.length === 1 ? "" : "s"} added to the editorial queue.`,
        );
    } catch {
      setMessage("Network error.");
    } finally {
      setApiKey("");
      setBusy(false);
    }
  }

  return (
    <details className="graph-curation-control">
      <summary>Editor: propose missing graph relations with AI</summary>
      <p className="muted">
        The model may create private proposals only. It cannot confirm edges, alter TRUST, or
        publish.
      </p>
      <div className="filters">
        <div className="field">
          <label htmlFor="curation-provider">Provider</label>
          <select
            id="curation-provider"
            value={provider}
            onChange={(event) =>
              setProvider(event.target.value === "openai" ? "openai" : "anthropic")
            }
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="curation-key">Transient API key</label>
          <input
            id="curation-key"
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="curation-model">Model (optional)</label>
          <input
            id="curation-model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
        </div>
      </div>
      <button
        className="btn btn-secondary"
        type="button"
        disabled={busy || apiKey.trim().length < 20}
        onClick={() => void propose()}
      >
        {busy ? "Generating proposals…" : "Generate private proposals"}
      </button>
      {message ? (
        <p role="status">
          {message} <a href="/editorial">Open editorial queue</a>.
        </p>
      ) : null}
    </details>
  );
}
