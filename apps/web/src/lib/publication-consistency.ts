import {
  type DoiCheck,
  type DoiValidationReport,
  type EffectiveMetadata,
  type InspectionReport,
  type PublicationConsistencyReport,
  type SubmissionValidationReport,
} from "@oratlas/contracts";

function normalizeTag(value: string): string {
  return value
    .trim()
    .replace(/^refs\/tags\//i, "")
    .replace(/^v/i, "")
    .toLowerCase();
}

function normalizeDoi(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

type AddCheck = (check: DoiCheck, message?: string) => void;

function assessDoiRole(
  role: "version" | "concept",
  report: DoiValidationReport | undefined,
  add: AddCheck,
): void {
  const label = role === "version" ? "Version" : "Concept";
  const valid = report?.status === "valid" || report?.status === "valid-with-warnings";
  add(
    {
      id: `${role}-doi-validity`,
      description: `${label} DOI resolves and is structurally valid`,
      outcome: valid ? (report.status === "valid-with-warnings" ? "warn" : "pass") : "fail",
      details: report ? `Validation status: ${report.status}.` : "No validation report exists.",
    },
    valid
      ? report?.status === "valid-with-warnings"
        ? `The ${role} DOI validated with warnings.`
        : undefined
      : `The ${role} DOI is invalid, unresolved, an example, or was not validated.`,
  );
  if (!report || !valid) return;
  const wrongKind =
    (role === "version" && report.doiKind === "concept") ||
    (role === "concept" && report.doiKind === "version");
  add(
    {
      id: `${role}-doi-kind`,
      description: `${label} DOI has the declared DOI role`,
      outcome: wrongKind ? "fail" : report.doiKind === "unknown" ? "warn" : "pass",
      details: `Resolved role: ${report.doiKind}.`,
    },
    wrongKind
      ? `The supplied ${role} DOI resolves as a ${report.doiKind} DOI.`
      : report.doiKind === "unknown"
        ? `The ${role} DOI role could not be independently classified.`
        : undefined,
  );
}

interface GithubSourceRef {
  repositoryIdentity: string;
  commit?: string;
  tag?: string;
}

function parseGithubSourceUrl(value: string): GithubSourceRef | undefined {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (url.hostname.toLowerCase() !== "github.com") return undefined;
    const segments = url.pathname.split("/").filter(Boolean);
    const owner = segments[0];
    const repository = segments[1]?.replace(/\.git$/i, "");
    if (!owner || !repository) return undefined;
    const result: GithubSourceRef = {
      repositoryIdentity:
        `${decodeURIComponent(owner)}/${decodeURIComponent(repository)}`.toLowerCase(),
    };
    if (segments[2] === "commit" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(segments[3] ?? "")) {
      result.commit = segments[3]!.toLowerCase();
    } else if (segments[2] === "tree" && segments[3]) {
      result.tag = decodeURIComponent(segments.slice(3).join("/"));
    } else if (segments[2] === "releases" && segments[3] === "tag" && segments[4]) {
      result.tag = decodeURIComponent(segments.slice(4).join("/"));
    }
    return result;
  } catch {
    return undefined;
  }
}

/** Deterministic cross-check of the exact Git source, release declaration and deposit metadata. */
export function buildPublicationConsistency(
  report: InspectionReport,
  effective: EffectiveMetadata,
  doiValidation: SubmissionValidationReport["doiValidation"],
): PublicationConsistencyReport {
  const source = report.selectedSource;
  if (!source) throw new Error("Inspection did not select an immutable source.");

  const checks: DoiCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const failed = new Set<string>();
  const add = (check: DoiCheck, message?: string) => {
    checks.push(check);
    if (check.outcome === "fail") {
      failed.add(check.id);
      if (message) errors.push(message);
    } else if (check.outcome === "warn" && message) {
      warnings.push(message);
    }
  };

  add({
    id: "source-commit",
    description: "The inspection is pinned to an immutable Git commit and tree",
    outcome: "pass",
    details: `${source.commitSha} (tree ${source.treeSha})`,
  });

  if (!effective.commitSha) {
    add(
      {
        id: "metadata-commit",
        description: "Metadata identifies the selected commit",
        outcome: "warn",
      },
      "Metadata does not declare a commit; the captured commit remains authoritative.",
    );
  } else if (effective.commitSha.toLowerCase() !== source.commitSha.toLowerCase()) {
    add(
      {
        id: "metadata-commit",
        description: "Metadata identifies the selected commit",
        outcome: "fail",
        details: `Metadata ${effective.commitSha}; selected ${source.commitSha}.`,
      },
      "Metadata commit differs from the explicitly selected Git commit.",
    );
  } else {
    add({
      id: "metadata-commit",
      description: "Metadata identifies the selected commit",
      outcome: "pass",
    });
  }

  const selectedTag = source.releaseTag;
  if (source.kind === "default-branch") {
    if (effective.releaseTag) {
      add(
        {
          id: "source-release-tag",
          description: "Release metadata agrees with the explicit source selection",
          outcome: "fail",
          details: `Metadata declares '${effective.releaseTag}' but the default branch was selected.`,
        },
        "A release tag was declared without selecting that tag or release.",
      );
    } else {
      checks.push({
        id: "source-release-tag",
        description: "Release metadata agrees with the explicit source selection",
        outcome: "skipped",
        details: "Repository-only publication deliberately selected.",
      });
    }
  } else if (
    !effective.releaseTag ||
    normalizeTag(effective.releaseTag) !== normalizeTag(selectedTag ?? "")
  ) {
    add(
      {
        id: "source-release-tag",
        description: "Release metadata agrees with the explicit source selection",
        outcome: "fail",
        details: `Metadata '${effective.releaseTag ?? "(missing)"}'; selected '${selectedTag}'.`,
      },
      "The selected tag/release and submitted release metadata differ.",
    );
  } else {
    add({
      id: "source-release-tag",
      description: "Release metadata agrees with the explicit source selection",
      outcome: "pass",
    });
  }

  const versionDoi = doiValidation?.versionDoi;
  if (effective.versionDoi) {
    assessDoiRole("version", versionDoi, add);

    if (source.kind === "default-branch") {
      add(
        {
          id: "version-doi-source",
          description: "A version DOI is bound to an explicit release/tag",
          outcome: "fail",
        },
        "A version DOI requires selecting the deposited release or tag, not a mutable default branch.",
      );
    } else if (versionDoi?.recordVersionTag) {
      const matches = normalizeTag(versionDoi.recordVersionTag) === normalizeTag(selectedTag ?? "");
      add(
        {
          id: "deposit-release-tag",
          description: "Deposit version agrees with the selected tag/release",
          outcome: matches ? "pass" : "fail",
          details: `Deposit '${versionDoi.recordVersionTag}'; selected '${selectedTag}'.`,
        },
        matches ? undefined : "The DOI deposit version differs from the selected Git tag.",
      );
    } else {
      add(
        {
          id: "deposit-release-tag",
          description: "Deposit version agrees with the selected tag/release",
          outcome: "warn",
        },
        "The DOI deposit does not expose a version tag for comparison.",
      );
    }

    if (effective.zenodoRecordId && versionDoi?.zenodoRecordId) {
      const matches = effective.zenodoRecordId === versionDoi.zenodoRecordId;
      add(
        {
          id: "deposit-record-id",
          description: "Declared Zenodo record agrees with the version DOI",
          outcome: matches ? "pass" : "fail",
          details: `Declared ${effective.zenodoRecordId}; DOI record ${versionDoi.zenodoRecordId}.`,
        },
        matches
          ? undefined
          : "The declared Zenodo record and version DOI identify different deposits.",
      );
    }

    const release = report.releases.find(
      (candidate) => candidate.tagName === selectedTag && !candidate.isDraft,
    );
    if (source.kind === "release" && release) {
      const bodyDois = release.bodyDois.map(normalizeDoi);
      if (bodyDois.length === 0) {
        add(
          {
            id: "release-version-doi",
            description: "GitHub release declares the version DOI",
            outcome: "warn",
          },
          "The selected GitHub release does not declare a DOI in its body.",
        );
      } else {
        const matches = bodyDois.includes(normalizeDoi(effective.versionDoi));
        add(
          {
            id: "release-version-doi",
            description: "GitHub release declares the version DOI",
            outcome: matches ? "pass" : "fail",
          },
          matches ? undefined : "The selected GitHub release declares a different DOI.",
        );
      }
    }

    if (versionDoi?.recordRepositoryUrls.length) {
      const expectedIdentity = `${report.repo.owner}/${report.repo.name}`.toLowerCase();
      const githubSources = versionDoi.recordRepositoryUrls
        .map(parseGithubSourceUrl)
        .filter((entry): entry is GithubSourceRef => Boolean(entry));
      const identityMatches = githubSources.some(
        (entry) => entry.repositoryIdentity === expectedIdentity,
      );
      add(
        {
          id: "deposit-repository",
          description: "Deposit GitHub repository agrees with the captured repository",
          outcome: identityMatches ? "pass" : "fail",
          details: githubSources.length
            ? `Deposit: ${githubSources.map((entry) => entry.repositoryIdentity).join(", ")}; captured: ${expectedIdentity}.`
            : "No GitHub repository URL was present in deposit metadata.",
        },
        identityMatches
          ? undefined
          : "The DOI deposit does not identify the captured GitHub owner/repository.",
      );
      const matchingSources = githubSources.filter(
        (entry) => entry.repositoryIdentity === expectedIdentity,
      );
      const commitRefs = matchingSources.flatMap((entry) => (entry.commit ? [entry.commit] : []));
      const tagRefs = matchingSources.flatMap((entry) => (entry.tag ? [entry.tag] : []));
      if (commitRefs.length > 0) {
        const matches = commitRefs.includes(source.commitSha.toLowerCase());
        add(
          {
            id: "deposit-commit",
            description: "Deposit source link agrees with the selected commit",
            outcome: matches ? "pass" : "fail",
          },
          matches ? undefined : "The DOI deposit points to a different Git commit.",
        );
      } else if (tagRefs.length > 0 && selectedTag) {
        const matches = tagRefs.some((tag) => normalizeTag(tag) === normalizeTag(selectedTag));
        add(
          {
            id: "deposit-commit",
            description: "Deposit source link agrees with the selected tag",
            outcome: matches ? "pass" : "fail",
          },
          matches ? undefined : "The DOI deposit points to a different Git tag.",
        );
      } else if (source.kind !== "default-branch") {
        add(
          {
            id: "deposit-commit",
            description: "Deposit links to the selected commit or tag",
            outcome: "warn",
          },
          "The DOI deposit has no commit- or tag-specific GitHub source link.",
        );
      }
    }
  }

  const conceptDoi = doiValidation?.conceptDoi;
  if (effective.conceptDoi) {
    assessDoiRole("concept", conceptDoi, add);
    if (conceptDoi?.recordRepositoryUrls.length) {
      const expectedIdentity = `${report.repo.owner}/${report.repo.name}`.toLowerCase();
      const identities = conceptDoi.recordRepositoryUrls
        .map(parseGithubSourceUrl)
        .filter((entry): entry is GithubSourceRef => Boolean(entry))
        .map((entry) => entry.repositoryIdentity);
      const matches = identities.includes(expectedIdentity);
      add(
        {
          id: "concept-deposit-repository",
          description: "Concept DOI deposit agrees with the captured GitHub repository",
          outcome: matches ? "pass" : "fail",
          details: identities.length
            ? `Deposit: ${identities.join(", ")}; captured: ${expectedIdentity}.`
            : "No GitHub repository URL was present in concept deposit metadata.",
        },
        matches ? undefined : "The concept DOI deposit identifies a different repository.",
      );
    }
    if (versionDoi?.discoveredConceptDoi) {
      const matches =
        normalizeDoi(versionDoi.discoveredConceptDoi) === normalizeDoi(effective.conceptDoi);
      add(
        {
          id: "deposit-concept-doi",
          description: "Declared concept DOI agrees with the version deposit",
          outcome: matches ? "pass" : "fail",
          details: `Version deposit '${versionDoi.discoveredConceptDoi}'; declared '${effective.conceptDoi}'.`,
        },
        matches ? undefined : "The declared concept DOI differs from the version deposit lineage.",
      );
    }
  } else if (versionDoi?.discoveredConceptDoi) {
    add(
      {
        id: "deposit-concept-doi",
        description: "Version deposit exposes its concept DOI",
        outcome: "warn",
        details: `Discovered ${versionDoi.discoveredConceptDoi}; none was declared.`,
      },
      "The version deposit exposes a concept DOI that was not declared in the submission.",
    );
  }

  const repositoryOnly =
    source.kind === "default-branch" && !effective.releaseTag && !effective.versionDoi;
  const status =
    failed.size > 0
      ? "fail"
      : checks.some((check) => check.outcome === "warn")
        ? "warn"
        : repositoryOnly
          ? "not-applicable"
          : "pass";
  return {
    schemaVersion: "1.0.0",
    status,
    selectedSourceKind: source.kind,
    selectedCommitSha: source.commitSha,
    selectedTreeSha: source.treeSha,
    selectedReleaseTag: selectedTag,
    checks,
    errors,
    warnings,
    overridableCheckIds: [...failed].sort(),
    requiresEditorOverride: failed.size > 0,
  };
}
