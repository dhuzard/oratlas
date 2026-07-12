"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface VersionOption {
  id: string;
  label: string;
  publicState: string;
  commitSha: string;
  isCurrent: boolean;
}

export function LifecycleForm({
  reviewSlug,
  revision,
  versions,
}: {
  reviewSlug: string;
  revision: number;
  versions: VersionOption[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"correction" | "withdrawal" | "tombstone">("correction");
  const [targetId, setTargetId] = useState(versions[0]?.id ?? "");
  const [supersedesId, setSupersedesId] = useState(versions[1]?.id ?? "");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const target = useMemo(
    () => versions.find((version) => version.id === targetId),
    [targetId, versions],
  );

  async function submit() {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/editorial/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewSlug,
          reviewVersionId: targetId,
          kind,
          reason,
          expectedRevision: revision,
          supersedesVersionId: kind === "correction" ? supersedesId : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body?.error?.message ?? "Lifecycle event failed.");
        return;
      }
      setMessage(`${kind} recorded at revision ${body.revision}.`);
      setReason("");
      router.refresh();
    } catch {
      setMessage("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="field">
        <label htmlFor={`lifecycle-kind-${reviewSlug}`}>Event</label>
        <select
          id={`lifecycle-kind-${reviewSlug}`}
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
        >
          <option value="correction">Correction</option>
          <option value="withdrawal">Withdrawal</option>
          <option value="tombstone">Tombstone / withhold content</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`lifecycle-target-${reviewSlug}`}>Target version</label>
        <select
          id={`lifecycle-target-${reviewSlug}`}
          value={targetId}
          onChange={(event) => setTargetId(event.target.value)}
        >
          {versions.map((version) => (
            <option
              key={version.id}
              value={version.id}
              disabled={
                version.publicState !== "published" || (kind === "correction" && !version.isCurrent)
              }
            >
              {version.label} — {version.publicState}
              {version.isCurrent ? " — current" : ""}
            </option>
          ))}
        </select>
        {target ? <small className="mono">exact commit {target.commitSha}</small> : null}
      </div>
      {kind === "correction" ? (
        <div className="field">
          <label htmlFor={`lifecycle-prior-${reviewSlug}`}>Prior version superseded</label>
          <select
            id={`lifecycle-prior-${reviewSlug}`}
            value={supersedesId}
            onChange={(event) => setSupersedesId(event.target.value)}
          >
            <option value="">Select prior version</option>
            {versions
              .filter(
                (version) =>
                  version.id !== targetId &&
                  version.publicState !== "tombstoned" &&
                  !version.isCurrent,
              )
              .map((version) => (
                <option key={version.id} value={version.id}>
                  {version.label} — {version.publicState}
                </option>
              ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={`lifecycle-reason-${reviewSlug}`}>Public reason</label>
        <textarea
          id={`lifecycle-reason-${reviewSlug}`}
          value={reason}
          minLength={20}
          maxLength={5000}
          onChange={(event) => setReason(event.target.value)}
        />
        <small>This reason, your identity, time and supersession link are append-only.</small>
      </div>
      <button
        className={kind === "tombstone" ? "btn btn-danger" : "btn"}
        type="button"
        disabled={
          loading ||
          !targetId ||
          reason.trim().length < 20 ||
          (kind === "correction" && !supersedesId)
        }
        onClick={submit}
      >
        {loading ? "Recording…" : `Record ${kind}`}
      </button>
      {message ? (
        <p role="status" className="notice notice-info">
          {message}
        </p>
      ) : null}
    </div>
  );
}
