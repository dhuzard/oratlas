"use client";
import { useState } from "react";

interface InspectResponse {
  repo: { owner: string; name: string; canonicalUrl: string };
  inspectionStatus: string;
  inspectionWarnings: string[];
  inspectionError?: string;
  effectiveMetadata: Record<string, unknown>;
  extractedMetadata: {
    fields: Record<string, { value: unknown; provenance: { source: string; confidence: number } }>;
  };
  compatibility: {
    overallCompatibility: string;
    levelRationale: string[];
    blockingErrors: string[];
    warnings: string[];
    recommendations: string[];
  };
  validation: {
    hardErrors: string[];
    warnings: string[];
    metadataCompleteness: {
      requiredMissing: string[];
      recommendedMissing: string[];
      score: number;
    };
    releaseValidation: { releaseDetected: boolean; details: string[] };
    evidenceDataAvailable: boolean;
    trustDataAvailable: boolean;
    doiValidation?: {
      versionDoi?: { status: string; confidence: string; warnings: string[]; errors: string[] };
      conceptDoi?: { status: string; confidence: string };
    };
  };
  knowledgeCounts: { claims: number; citations: number; relations: number; trust: number };
}

const EDITABLE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "title", label: "Review title" },
  { key: "abstract", label: "Short abstract" },
  { key: "license", label: "License" },
  { key: "publishedReviewUrl", label: "Published review URL" },
  { key: "releaseTag", label: "Release tag" },
  { key: "versionDoi", label: "Version DOI" },
  { key: "conceptDoi", label: "Concept DOI" },
  { key: "zenodoRecordId", label: "Zenodo record" },
  { key: "contact", label: "Contact / corresponding author" },
];

const STEPS = ["Repository", "Inspect", "Review metadata", "Validation", "Submit"];

export function SubmitWizard({ signedIn }: { signedIn: boolean }) {
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<InspectResponse | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ submissionId: string; status: string } | null>(null);

  async function inspect() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Inspection failed.");
        return;
      }
      setInspection(data as InspectResponse);
      const eff = (data as InspectResponse).effectiveMetadata;
      const seed: Record<string, string> = {};
      for (const f of EDITABLE_FIELDS) {
        const v = eff[f.key];
        if (typeof v === "string") seed[f.key] = v;
      }
      setEdits(seed);
      setStep(2);
    } catch {
      setError("Network error during inspection.");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!inspection) return;
    setLoading(true);
    setError(null);
    try {
      const editedMetadata = buildEditedMetadata(inspection, edits);
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: inspection.repo.canonicalUrl, editedMetadata }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Submission failed.");
        return;
      }
      setResult(data);
      setStep(4);
    } catch {
      setError("Network error during submission.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <ol className="wizard-steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}

      {!signedIn ? (
        <div className="notice notice-warning">
          You must <a href="/signin">sign in</a> to finalize a submission. You can still inspect a
          repository.
        </div>
      ) : null}

      {step <= 1 ? (
        <div className="card">
          <div className="field">
            <label htmlFor="repo-url">Public GitHub repository URL</label>
            <input
              id="repo-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repository"
              autoComplete="off"
            />
            <small>
              Public repositories only. The repository is inspected via the GitHub API; it is never
              cloned or executed.
            </small>
          </div>
          <button className="btn" onClick={inspect} disabled={loading || url.trim().length === 0}>
            {loading ? "Inspecting…" : "Inspect repository"}
          </button>
        </div>
      ) : null}

      {step === 2 && inspection ? (
        <div className="card">
          <h2 className="card-title">Review extracted metadata</h2>
          <p className="muted">
            Each value shows where it was extracted from. Edits are stored separately from the
            extracted value and never overwrite it.
          </p>
          <p>
            <strong>Compatibility:</strong> {inspection.compatibility.overallCompatibility}
          </p>
          {EDITABLE_FIELDS.map((f) => {
            const field = inspection.extractedMetadata.fields[f.key];
            return (
              <div className="field" key={f.key}>
                <label htmlFor={`f-${f.key}`}>{f.label}</label>
                {f.key === "abstract" ? (
                  <textarea
                    id={`f-${f.key}`}
                    value={edits[f.key] ?? ""}
                    onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })}
                  />
                ) : (
                  <input
                    id={`f-${f.key}`}
                    type="text"
                    value={edits[f.key] ?? ""}
                    onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })}
                  />
                )}
                <small>
                  {field
                    ? `extracted from ${field.provenance.source} (confidence ${Math.round(
                        field.provenance.confidence * 100,
                      )}%)`
                    : "not extracted — enter manually if applicable"}
                </small>
              </div>
            );
          })}
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setStep(0)}>
              Back
            </button>
            <button className="btn" onClick={() => setStep(3)}>
              Continue to validation
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 && inspection ? (
        <div className="card">
          <h2 className="card-title">Validation</h2>
          <ValidationView inspection={inspection} />
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="btn" onClick={submit} disabled={loading || !signedIn}>
              {loading ? "Submitting…" : "Submit for editorial review"}
            </button>
          </div>
        </div>
      ) : null}

      {step === 4 && result ? (
        <div className="card">
          <h2 className="card-title">Submission received</h2>
          <p>
            Status: <strong>{result.status.replace(/-/g, " ")}</strong>
          </p>
          <p className="muted">
            Your submission entered the editorial workflow. Acceptance into the archive is not peer
            review. An editor will review the immutable snapshot you submitted.
          </p>
          <p className="mono">Submission ID: {result.submissionId}</p>
          <a className="btn btn-secondary" href="/archive">
            Browse the archive
          </a>
        </div>
      ) : null}
    </div>
  );
}

function ValidationView({ inspection }: { inspection: InspectResponse }) {
  const v = inspection.validation;
  return (
    <>
      {v.hardErrors.length > 0 ? (
        <div className="notice notice-error">
          <strong>Hard errors</strong>
          <ul>
            {v.hardErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="notice notice-success">No blocking errors.</div>
      )}

      {v.warnings.length > 0 ? (
        <div className="notice notice-warning">
          <strong>Warnings</strong>
          <ul>
            {v.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul>
        <li>Compatibility: {inspection.compatibility.overallCompatibility}</li>
        <li>
          Release:{" "}
          {v.releaseValidation.releaseDetected ? "detected" : "none (repository-only eligible)"}
        </li>
        <li>
          Metadata completeness: {Math.round(v.metadataCompleteness.score * 100)}%
          {v.metadataCompleteness.requiredMissing.length > 0
            ? ` — missing: ${v.metadataCompleteness.requiredMissing.join(", ")}`
            : ""}
        </li>
        <li>Evidence data: {v.evidenceDataAvailable ? "available" : "none"}</li>
        <li>TRUST data: {v.trustDataAvailable ? "available" : "none"}</li>
        <li>
          Knowledge: {inspection.knowledgeCounts.claims} claims,{" "}
          {inspection.knowledgeCounts.citations} citations, {inspection.knowledgeCounts.trust} TRUST
          records
        </li>
      </ul>

      {v.doiValidation?.versionDoi ? (
        <p>
          Version DOI: {v.doiValidation.versionDoi.status} (confidence{" "}
          {v.doiValidation.versionDoi.confidence})
        </p>
      ) : (
        <p className="muted">
          No DOI supplied. The review can be accepted as repository-only; the owner can later
          connect the repository to Zenodo and publish a release.
        </p>
      )}

      {inspection.compatibility.recommendations.length > 0 ? (
        <div className="notice notice-info">
          <strong>Recommendations</strong>
          <ul>
            {inspection.compatibility.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function buildEditedMetadata(inspection: InspectResponse, edits: Record<string, string>) {
  const editsOut: Record<string, { value: unknown; meta: { editedAt: string } }> = {};
  const now = new Date().toISOString();
  for (const f of EDITABLE_FIELDS) {
    const extracted = inspection.effectiveMetadata[f.key];
    const edited = edits[f.key]?.trim() ?? "";
    const extractedStr = typeof extracted === "string" ? extracted : "";
    if (edited !== extractedStr && edited.length > 0) {
      editsOut[f.key] = { value: edited, meta: { editedAt: now } };
    }
  }
  return { edits: editsOut };
}
