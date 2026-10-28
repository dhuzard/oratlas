"use client";
import { useEffect, useRef, useState } from "react";
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

const STEPS = ["Source", "Inspect and correct", "Submit and status"];

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
  const inFlight = useRef(false);
  const goalHeading = useRef<HTMLHeadingElement>(null);
  const [reviewed, setReviewed] = useState(false);
  const [captureInvalid, setCaptureInvalid] = useState(false);
  const [previousCommit, setPreviousCommit] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const expiry = inspection ? Date.parse(inspection.captureExpiresAt) : 0;
  const expired = Boolean(inspection && (!Number.isFinite(expiry) || now >= expiry));
  const needsCapture = expired || captureInvalid;
  const goal = step === 0 ? 0 : step === 2 ? 1 : 2;

  useEffect(() => {
    if (!inspection || result) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [inspection, result]);

  useEffect(() => {
    if (inspection && step !== 0) goalHeading.current?.focus();
  }, [step, inspection]);

  async function inspect() {
    if (inFlight.current || !signedIn) return;
    inFlight.current = true;
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
      setPreviousCommit(
        inspection?.repo.canonicalUrl === data.repo.canonicalUrl
          ? inspection!.selectedSource.commitSha
          : null,
      );
      setInspection(data as InspectResponse);
      setReviewed(false);
      setCaptureInvalid(false);
      setNow(Date.now());
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
      inFlight.current = false;
      setLoading(false);
    }
  }

  async function submit() {
    if (!inspection || inFlight.current || result || !reviewed || needsCapture || !signedIn) return;
    if (Date.now() >= Date.parse(inspection.captureExpiresAt)) {
      setNow(Date.now());
      return;
    }
    inFlight.current = true;
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
        if (
          res.status === 409 ||
          /capability|capture|inspection token/i.test(data?.error?.message ?? "")
        ) {
          setCaptureInvalid(true);
          setReviewed(false);
        }
        return;
      }
      setResult(data);
      setStep(5);
    } catch {
      setCaptureInvalid(true);
      setReviewed(false);
      setError(
        "The submission response was lost, so the outcome is unknown. Your source selection and corrections remain here. If you did not receive a submission ID, ask an editor to check whether it was recorded before starting another submission. Reinspect and review a new capture before trying again; this capture will not be resent.",
      );
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <div>
      <ol className="wizard-steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === goal ? "step" : undefined}>
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

      {inspection && step !== 0 && !result ? (
        <section className="card deposit-capture" aria-label="Captured source and expiry">
          <h2 className="card-title">Captured source</h2>
          <p>
            {inspection.repo.canonicalUrl} · {inspection.selectedSource.kind}
            {inspection.selectedSource.releaseTag || inspection.selectedSource.branch
              ? ` · ${inspection.selectedSource.releaseTag ?? inspection.selectedSource.branch}`
              : ""}
          </p>
          <p>
            Exact commit: <code>{inspection.selectedSource.commitSha}</code>
          </p>
          <p>
            The capture is bound to your signed-in account, can be submitted once, and expires after
            30 minutes. Expires{" "}
            <time dateTime={inspection.captureExpiresAt}>
              {new Date(inspection.captureExpiresAt).toLocaleString()}
            </time>
            .
          </p>
          {previousCommit && previousCommit !== inspection.selectedSource.commitSha ? (
            <div className="notice notice-warning" role="status">
              <strong>The source commit changed during reinspection.</strong>
              <p>
                Previous commit: <code>{previousCommit}</code>
              </p>
              <p>
                New commit: <code>{inspection.selectedSource.commitSha}</code>. Review the new
                capture and corrections before continuing.
              </p>
            </div>
          ) : null}
          {needsCapture ? (
            <p className="notice notice-warning" role="status">
              This capture expired or cannot be submitted. Reinspect the source and review the new
              capture before submitting.
            </p>
          ) : null}
          <p className="muted">
            Reinspection creates a new capture. Its resolved commit and extracted values may differ;
            previous corrections are not applied automatically.
          </p>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={inspect} disabled={loading || !signedIn}>
              {loading ? "Working…" : "Reinspect captured source"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setError(null);
                setStep(0);
              }}
              disabled={loading}
            >
              Change source selection
            </button>
          </div>
          <details>
            <summary>Capture digest</summary>
            <p className="mono">{inspection.capturePayloadHash}</p>
          </details>
        </section>
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
              disabled={loading}
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
              disabled={loading}
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
                disabled={loading}
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
        <section className="card" aria-labelledby="deposit-corrections-title">
          <h2 id="deposit-corrections-title" className="card-title" ref={goalHeading} tabIndex={-1}>
            Inspect and correct
          </h2>
          <p>
            Address required corrections first, then review metadata and any node candidates below.
            These checks describe the captured source; the server validates your submitted
            corrections.
          </p>
          <p className="muted">
            Unresolved checks can enter the existing automated-checks-failed state for editorial
            attention. Submitting does not waive checks or grant acceptance.
          </p>
          <ValidationView inspection={inspection} />
        </section>
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
          {inspection.selectedSource.kind === "default-branch" &&
          typeof inspection.effectiveMetadata.releaseTag === "string" ? (
            <div className="notice notice-warning">
              Zenodo identifies release{" "}
              <strong>{inspection.effectiveMetadata.releaseTag as string}</strong>, but this
              inspection captured the mutable default branch. Go back and choose “Published GitHub
              release” with that exact tag before submitting the version DOI.
            </div>
          ) : null}
          {[...EDITABLE_FIELDS]
            .sort(
              (a, b) =>
                Number(inspection.validation.metadataCompleteness.requiredMissing.includes(b.key)) -
                Number(inspection.validation.metadataCompleteness.requiredMissing.includes(a.key)),
            )
            .map((f) => {
              const field = inspection.extractedMetadata.fields[f.key];
              return (
                <div className="field" key={f.key}>
                  <label htmlFor={`f-${f.key}`}>
                    {f.label}
                    {inspection.validation.metadataCompleteness.requiredMissing.includes(f.key)
                      ? " — required correction"
                      : ""}
                  </label>
                  {f.key === "abstract" ? (
                    <textarea
                      id={`f-${f.key}`}
                      value={edits[f.key] ?? ""}
                      disabled={loading}
                      onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })}
                    />
                  ) : (
                    <input
                      id={`f-${f.key}`}
                      type="text"
                      value={edits[f.key] ?? ""}
                      disabled={loading}
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
        </div>
      ) : null}

      {step === 2 && inspection ? (
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
          <label className="deposit-review-confirmation">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
              disabled={loading || needsCapture}
            />
            <span>I reviewed this capture and its source version</span>
          </label>
          <div className="btn-row">
            <button
              className="btn"
              onClick={() => setStep(4)}
              disabled={loading || !reviewed || needsCapture}
            >
              Continue to submission
            </button>
          </div>
        </div>
      ) : null}

      {step === 4 && inspection ? (
        <div className="card">
          <h2 className="card-title" ref={goalHeading} tabIndex={-1}>
            Submit this exact capture
          </h2>
          <p>
            Submit the reviewed capture and your separate metadata corrections for an editorial
            decision. The source bytes remain unchanged.
          </p>
          <p>
            {Object.keys(buildEditedMetadata(inspection, edits).edits).length} metadata
            correction(s) will accompany this capture.
          </p>
          <p className="muted">
            The server rechecks the capability, source binding and validation. Required corrections
            may produce automated-checks-failed rather than pending editorial review.
          </p>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setStep(2)} disabled={loading}>
              Return to corrections
            </button>
            <button
              className="btn"
              onClick={submit}
              disabled={loading || !signedIn || !reviewed || needsCapture || Boolean(result)}
            >
              {loading ? "Submitting…" : "Submit for editorial review"}
            </button>
          </div>
        </div>
      ) : null}

      {step === 5 && result ? (
        <div className="card">
          <h2 className="card-title" ref={goalHeading} tabIndex={-1}>
            Submission received
          </h2>
          <p>
            Status: <strong>{result.status.replace(/-/g, " ")}</strong>
          </p>
          <p className="muted">
            Your submission entered the editorial workflow. Acceptance into the archive is not peer
            review. An editor will review the immutable snapshot you submitted.
          </p>
          <p className="mono">Submission ID: {result.submissionId}</p>
          <p>
            <a className="btn" href={`/submissions/${encodeURIComponent(result.submissionId)}`}>
              View submission status and next steps
            </a>
          </p>
          <p className="muted">
            Keep this status link to revisit the recorded outcome. It requires the account that
            submitted the capture.
          </p>
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
          <strong>Required corrections in the captured source</strong>
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
