"use client";
import { useState } from "react";
import type { FacetCompatibilityReport } from "@oratlas/contracts";
import { CompatibilityFacets } from "@/components/CompatibilityFacets";

interface InspectResponse {
  repo: { owner: string; name: string; canonicalUrl: string };
  inspectionStatus: string;
  inspectionWarnings: string[];
  inspectionError?: string;
  captureToken: string;
  captureExpiresAt: string;
  capturePayloadHash: string;
  selectedSource: {
    kind: "default-branch" | "tag" | "release";
    commitSha: string;
    treeSha: string;
    branch?: string;
    releaseTag?: string;
  };
  effectiveMetadata: Record<string, unknown>;
  extractedMetadata: {
    fields: Record<string, { value: unknown; provenance: { source: string; confidence: number } }>;
  };
  compatibility: {
    overallCompatibility: string;
    facets?: FacetCompatibilityReport;
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
    publicationConsistency?: {
      status: "pass" | "warn" | "fail" | "not-applicable";
      checks: Array<{ id: string; description: string; outcome: string; details?: string }>;
      errors: string[];
      warnings: string[];
      requiresEditorOverride: boolean;
    };
  };
  knowledgeCounts: { claims: number; citations: number; relations: number; trust: number };
  publicationTargets: { proseReview: boolean; knowledgeNodes: boolean };
  nodeExtraction: {
    nodes: Array<{
      status: "ok" | "invalid" | "skipped";
      sourcePath: string;
      sourcePointer: string;
      declaredId?: string;
      node?: {
        id: string;
        kind: "claim" | "figure" | "dataset" | "code";
        title: string;
        abstract?: string;
        text?: string;
        license: string;
      };
      fieldProvenance: Record<
        string,
        { file: string; pointer: string; commitSha?: string; extractorVersion: string }
      >;
      issues: Array<{ severity: "error" | "warning"; code: string; message: string }>;
    }>;
  };
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

const STEPS = ["Repository", "Inspect", "Review metadata", "Review nodes", "Validation", "Submit"];

export function SubmitWizard({ signedIn }: { signedIn: boolean }) {
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("");
  const [sourceKind, setSourceKind] = useState<"default-branch" | "tag" | "release">(
    "default-branch",
  );
  const [sourceTag, setSourceTag] = useState("");
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
        body: JSON.stringify({
          url,
          source:
            sourceKind === "default-branch"
              ? { kind: "default-branch" }
              : { kind: sourceKind, tag: sourceTag.trim() },
        }),
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
        body: JSON.stringify({ inspectionToken: inspection.captureToken, editedMetadata }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Submission failed.");
        return;
      }
      setResult(data);
      setStep(5);
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
          You must <a href="/signin">sign in</a> before inspection so the expiring submission
          capability can be bound to your account.
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
          <div className="field">
            <label htmlFor="source-kind">Source to capture</label>
            <select
              id="source-kind"
              value={sourceKind}
              onChange={(event) =>
                setSourceKind(event.target.value as "default-branch" | "tag" | "release")
              }
            >
              <option value="default-branch">Repository only — current default branch</option>
              <option value="release">Published GitHub release</option>
              <option value="tag">Git tag that is not a published release</option>
            </select>
            <small>
              This choice is explicit and is pinned to the commit resolved during inspection.
            </small>
          </div>
          {sourceKind !== "default-branch" ? (
            <div className="field">
              <label htmlFor="source-tag">Exact tag</label>
              <input
                id="source-tag"
                type="text"
                value={sourceTag}
                onChange={(event) => setSourceTag(event.target.value)}
                placeholder="v1.2.0"
                autoComplete="off"
              />
            </div>
          ) : null}
          <button
            className="btn"
            onClick={inspect}
            disabled={
              loading ||
              !signedIn ||
              url.trim().length === 0 ||
              (sourceKind !== "default-branch" && sourceTag.trim().length === 0)
            }
          >
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
          <CompatibilityFacets facets={inspection.compatibility.facets} />
          <p className="mono">
            Captured {inspection.selectedSource.kind}: {inspection.selectedSource.commitSha}
          </p>
          <p className="muted">
            Capability expires {new Date(inspection.captureExpiresAt).toLocaleString()}; exact
            capture SHA-256 {inspection.capturePayloadHash}.
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
              Continue to node candidates
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 && inspection ? (
        <div className="card">
          <h2 className="card-title">Review extracted node candidates</h2>
          <p className="muted">
            These candidates and their extraction provenance become part of the immutable
            submission. An editor chooses the public subset; referenced artifacts are never fetched
            or executed.
          </p>
          {inspection.nodeExtraction.nodes.length === 0 ? (
            <p className="muted">No node manifest candidates were found.</p>
          ) : (
            inspection.nodeExtraction.nodes.map((record, index) => (
              <article className="claim-card" key={`${record.sourcePath}:${record.sourcePointer}`}>
                <p>
                  <strong>
                    {record.node?.title ?? record.declaredId ?? `Record ${index + 1}`}
                  </strong>{" "}
                  — {record.status}
                  {record.node ? ` · ${record.node.kind} · ${record.node.id}` : ""}
                </p>
                {record.node?.abstract ? <p>{record.node.abstract}</p> : null}
                {record.node?.text ? <p>{record.node.text}</p> : null}
                <p className="mono muted">
                  {record.sourcePath} {record.sourcePointer}
                </p>
                <p className="muted">
                  Field provenance: {Object.keys(record.fieldProvenance).sort().join(", ") || "—"}
                </p>
                {record.issues.length > 0 ? (
                  <ul>
                    {record.issues.map((issue) => (
                      <li key={`${issue.code}:${issue.message}`}>
                        {issue.severity}: {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))
          )}
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="btn" onClick={() => setStep(4)}>
              Continue to validation
            </button>
          </div>
        </div>
      ) : null}

      {step === 4 && inspection ? (
        <div className="card">
          <h2 className="card-title">Validation</h2>
          <ValidationView inspection={inspection} />
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setStep(3)}>
              Back
            </button>
            <button className="btn" onClick={submit} disabled={loading || !signedIn}>
              {loading ? "Submitting…" : "Submit for editorial review"}
            </button>
          </div>
        </div>
      ) : null}

      {step === 5 && result ? (
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
        <li>
          Node candidates:{" "}
          {
            inspection.nodeExtraction.nodes.filter(
              (record) => record.status === "ok" && Boolean(record.node),
            ).length
          }{" "}
          publishable (
          {inspection.publicationTargets.proseReview ? "with prose review" : "node-only"})
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

      {v.publicationConsistency ? (
        <div
          className={`notice ${
            v.publicationConsistency.status === "fail"
              ? "notice-error"
              : v.publicationConsistency.status === "warn"
                ? "notice-warning"
                : "notice-success"
          }`}
        >
          <strong>Release / DOI / commit consistency: {v.publicationConsistency.status}</strong>
          <ul>
            {v.publicationConsistency.checks.map((check) => (
              <li key={check.id}>
                {check.outcome}: {check.description}
                {check.details ? ` — ${check.details}` : ""}
              </li>
            ))}
          </ul>
          {v.publicationConsistency.requiresEditorOverride ? (
            <p>Every failed check requires a separate, audited editor rationale.</p>
          ) : null}
        </div>
      ) : null}

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
