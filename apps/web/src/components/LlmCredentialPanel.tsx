"use client";

import { useEffect, useState } from "react";

type Provider = "anthropic" | "openai";

interface CredentialStatus {
  available: boolean;
  source: "byok" | "platform" | "none";
  provider?: Provider;
  model?: string;
  expiresAt?: string;
}

export function LlmCredentialPanel({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [model, setModel] = useState("claude-sonnet-5");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void refreshStatus();
  }, []);

  function selectProvider(next: Provider) {
    setProvider(next);
    setModel(next === "anthropic" ? "claude-sonnet-5" : "gpt-5");
  }

  async function refreshStatus() {
    try {
      const response = await fetch("/api/llm-credentials", { cache: "no-store" });
      if (response.ok) setStatus((await response.json()) as CredentialStatus);
    } catch {
      setStatus({ available: false, source: "none" });
    }
  }

  async function connect() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/llm-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey, model }),
      });
      const data = (await response.json()) as CredentialStatus & {
        error?: { message?: string };
      };
      if (!response.ok) {
        setMessage(data.error?.message ?? "The credential could not be connected.");
        return;
      }
      setApiKey("");
      setStatus(data);
      setMessage("Provider connected for this browser session.");
    } catch {
      setMessage("Network error while connecting the provider.");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/llm-credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await response.json()) as CredentialStatus & {
        error?: { message?: string };
      };
      if (!response.ok) {
        setMessage(data.error?.message ?? "The credential could not be removed.");
        return;
      }
      setStatus(data);
      setMessage(
        data.source === "platform"
          ? "Browser credential removed; the platform provider remains available."
          : "Browser credential removed.",
      );
    } catch {
      setMessage("Network error while removing the credential.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="llm-credential-panel" open={!compact && status?.source === "none"}>
      <summary>LLM provider: {statusLabel(status)}</summary>
      <div className="card">
        <p className="muted">
          Connect an Anthropic or OpenAI key for grounded AI functions. The key is encrypted into a
          short-lived HttpOnly cookie, is never written to the database or an AgentRun, and expires
          after eight hours. ORAtlas sends the bounded evidence packet to the selected provider;
          provider billing and data terms apply.
        </p>
        <div className="filters">
          <div className="field">
            <label htmlFor={`llm-provider-${compact ? "compact" : "full"}`}>Provider</label>
            <select
              id={`llm-provider-${compact ? "compact" : "full"}`}
              value={provider}
              onChange={(event) => selectProvider(event.target.value as Provider)}
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`llm-model-${compact ? "compact" : "full"}`}>Model</label>
            <input
              id={`llm-model-${compact ? "compact" : "full"}`}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              maxLength={120}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor={`llm-key-${compact ? "compact" : "full"}`}>API key</label>
            <input
              id={`llm-key-${compact ? "compact" : "full"}`}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              maxLength={512}
              autoComplete="off"
              spellCheck={false}
              placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
            />
          </div>
        </div>
        <div className="btn-row">
          <button
            className="btn"
            type="button"
            disabled={busy || apiKey.trim().length < 10 || model.trim().length === 0}
            onClick={() => void connect()}
          >
            {busy ? "Updating…" : "Connect provider"}
          </button>
          {status?.source === "byok" ? (
            <button
              className="btn btn-secondary"
              type="button"
              disabled={busy}
              onClick={() => void clear()}
            >
              Remove browser key
            </button>
          ) : null}
        </div>
        {status?.source === "byok" && status.expiresAt ? (
          <p className="muted">
            Browser key expires {new Date(status.expiresAt).toLocaleString()}.
          </p>
        ) : null}
        {message ? (
          <p className="muted" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function statusLabel(status: CredentialStatus | null): string {
  if (!status) return "checking…";
  if (!status.available) return "deterministic mode";
  const provider = status.provider === "openai" ? "OpenAI" : "Anthropic";
  return `${provider} · ${status.model ?? "configured model"} · ${
    status.source === "byok" ? "browser key" : "platform key"
  }`;
}
