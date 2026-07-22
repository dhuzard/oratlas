import Link from "next/link";
import { Badge, Card, DefinitionList, Notice, TrustCriterionProfile } from "@oratlas/ui";
import { TRUST_CRITERIA, type PublicNodeDetail, type PublicNodeVersion } from "@oratlas/contracts";

export function NodeView({
  node,
  historical = false,
}: {
  node: PublicNodeDetail;
  historical?: boolean;
}) {
  const version = node.version;
  const current = node.versions.find((candidate) => candidate.isCurrent)!;
  return (
    <article>
      {historical ? (
        <Notice title="Historical immutable version">
          This page preserves the node content captured at commit{" "}
          <span className="mono">{version.commitSha.slice(0, 12)}</span>. The confirmed graph
          context can evolve independently.{" "}
          <Link href={`/nodes/${node.id}`}>View the current version</Link>.
        </Notice>
      ) : null}
      <div className="btn-row">
        <Badge>knowledge node</Badge>
        <Badge>{node.kind}</Badge>
        {version.isExample ? <Badge tone="warning">contains example identifier</Badge> : null}
      </div>
      <h1>{version.title}</h1>
      {version.abstract ? <p className="lead muted">{version.abstract}</p> : null}
      <p>
        <Link
          href={`/graph?seed=${encodeURIComponent(node.id)}&depth=1&limit=10&edgeStatus=confirmed`}
        >
          Explore this node’s graph
        </Link>
      </p>

      <div className="grid layout-2">
        <div>
          <Card title={`${kindLabel(node.kind)} content`}>
            <NodePayload version={version} />
            {version.text &&
            !(version.kind === "claim" && version.text === version.payload.statement) ? (
              <div>
                <h3>Text</h3>
                <p className="node-preserved-text">{version.text}</p>
              </div>
            ) : null}
          </Card>

          <Card title={`Confirmed graph relations (${node.edges.length})`}>
            <p className="muted">
              Only editor-confirmed relations are public here. Direction is relative to this node;
              relation presence does not establish scientific correctness.
            </p>
            {node.edges.length === 0 ? (
              <p className="muted">No confirmed relations are attached to this node.</p>
            ) : (
              <ul className="node-relation-list">
                {node.edges.map((edge) => (
                  <li key={`${edge.direction}:${edge.id}`}>
                    <div className="btn-row">
                      <Badge>{edge.direction}</Badge>
                      <Badge tone={edge.relationType === "contradicts" ? "warning" : "neutral"}>
                        {edge.relationType.replace(/-/g, " ")}
                      </Badge>
                      <Link
                        href={`/nodes/${edge.relatedNode.id}/versions/${edge.relatedNode.versionId}`}
                      >
                        {edge.relatedNode.title}
                      </Link>
                      <Badge>confirmed version</Badge>
                    </div>
                    {edge.rationale ? <p>{edge.rationale}</p> : null}
                    <p className="muted">
                      {edge.provenance.replace(/-/g, " ")}
                      {edge.assertedAt ? ` · ${edge.assertedAt.slice(0, 10)}` : ""}
                    </p>
                    {nodeEdgeTrustAssessments(edge).map((assessment) => (
                      <section
                        className="trust-block"
                        key={assessment.assessmentId}
                        aria-label={`Relation TRUST assessment ${assessment.assessmentId}`}
                      >
                        <p className="muted">
                          Relation TRUST: assessor{" "}
                          {assessment.assessorId ?? assessment.assessorType} ·{" "}
                          {assessment.reviewStatus.replace(/-/g, " ")} ·{" "}
                          {assessment.verificationState.replace(/-/g, " ")} · protocol{" "}
                          {assessment.protocolVersion}
                        </p>
                        <TrustCriterionProfile
                          criteria={assessment.criteria}
                          label={`TRUST criteria for relation assessment ${assessment.assessmentId}`}
                        />
                      </section>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {node.kind === "claim" ? (
            <Card title={`Claim–citation TRUST context (${node.trustContext.length})`}>
              <p className="muted">
                TRUST belongs to each exact claim–citation relation. It is not a score for this node
                and does not assert that the claim is true.
              </p>
              {node.trustContext.length === 0 ? (
                <p className="muted">
                  No relation-scoped TRUST context is attached to this node version.
                </p>
              ) : (
                <ul className="node-relation-list">
                  {node.trustContext.map((context) => (
                    <li key={`${context.claimId}:${context.citationId}`}>
                      <div className="btn-row">
                        <Badge>{context.relationType.replace(/-/g, " ")}</Badge>
                        <Link href={`/claims/${context.reviewVersionId}/${context.claimLocalId}`}>
                          {context.citationTitle ?? context.citationLocalId}
                        </Link>
                      </div>
                      {context.citationDoi ? (
                        <p className="mono">
                          {context.citationIsExample ? (
                            <>
                              {context.citationDoi} <Badge tone="warning">example DOI</Badge>
                            </>
                          ) : (
                            <a href={`https://doi.org/${context.citationDoi}`}>
                              {context.citationDoi}
                            </a>
                          )}
                        </p>
                      ) : null}
                      {nodeContextTrustAssessments(context).length > 0 ? (
                        nodeContextTrustAssessments(context).map((assessment) => (
                          <section
                            className="trust-block"
                            key={assessment.assessmentId}
                            aria-label={`Claim-citation TRUST assessment ${assessment.assessmentId}`}
                          >
                            <p className="muted">
                              assessor {assessment.assessorId ?? assessment.assessorType} · protocol{" "}
                              {assessment.protocolVersion} ·{" "}
                              {assessment.reviewStatus.replace(/-/g, " ")} ·{" "}
                              {assessment.verificationState.replace(/-/g, " ")}
                            </p>
                            <TrustCriterionProfile
                              criteria={assessment.criteria}
                              label={`TRUST criteria for claim-citation assessment ${assessment.assessmentId}`}
                            />
                          </section>
                        ))
                      ) : (
                        <p className="muted">No TRUST assessment on this relation.</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>

        <aside>
          <Card title="Identifiers">
            {version.identifiers.length === 0 ? (
              <p className="muted">No DOI was declared for this version.</p>
            ) : (
              <dl className="def-list">
                {version.identifiers.map((identifier) => (
                  <div className="def-row" key={`${identifier.role}:${identifier.value}`}>
                    <dt>{identifier.role.replace(/-/g, " ")}</dt>
                    <dd className="mono">
                      {identifier.isExample ? (
                        <>
                          {identifier.value} <Badge tone="warning">example — not linked</Badge>
                        </>
                      ) : (
                        <a href={`https://doi.org/${identifier.value}`}>{identifier.value}</a>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          <Card title="Provenance">
            <DefinitionList
              items={[
                { term: "Node ID", value: <span className="mono">{node.id}</span> },
                {
                  term: "Repository-local ID",
                  value: <span className="mono">{node.localNodeId}</span>,
                },
                {
                  term: "Repository",
                  value: (
                    <a href={node.repository.url}>
                      {node.repository.owner}/{node.repository.name}
                    </a>
                  ),
                },
                { term: "Commit", value: <span className="mono">{version.commitSha}</span> },
                {
                  term: "Source file",
                  value: <span className="mono">{version.provenance.sourcePath}</span>,
                },
                {
                  term: "Source pointer",
                  value: version.provenance.sourcePointer ?? <span className="muted">—</span>,
                },
                { term: "License", value: version.license },
                { term: "Captured", value: version.createdAt.slice(0, 10) },
              ]}
            />
          </Card>

          <Card title={`Contributors (${version.contributors.length})`}>
            {version.contributors.length === 0 ? (
              <p className="muted">No contributors were declared.</p>
            ) : (
              <ul>
                {version.contributors.map((contributor, index) => (
                  <li key={`${contributor.displayName}:${index}`}>
                    {contributor.displayName}
                    {(contributor.roles ?? []).length > 0
                      ? ` — ${(contributor.roles ?? []).join(", ")}`
                      : ""}
                    {contributor.orcid ? (
                      <>
                        {" "}
                        · <a href={`https://orcid.org/${contributor.orcid}`}>ORCID</a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Version history (${node.versions.length})`}>
            <ul>
              {node.versions.map((candidate) => (
                <li key={candidate.id}>
                  <Link href={`/nodes/${node.id}/versions/${candidate.id}`}>
                    {candidate.createdAt.slice(0, 10)} · {candidate.commitSha.slice(0, 12)}
                  </Link>{" "}
                  {candidate.id === version.id ? <Badge>shown</Badge> : null}{" "}
                  {candidate.isCurrent ? <Badge tone="success">current</Badge> : null}
                </li>
              ))}
            </ul>
            {historical && version.id !== current.id ? (
              <Link href={`/nodes/${node.id}`}>Return to current version</Link>
            ) : null}
          </Card>

          <Card title="Machine-readable API">
            <a
              href={
                historical
                  ? `/api/nodes/${node.id}/versions/${version.id}`
                  : `/api/nodes/${node.id}`
              }
            >
              JSON for this node version
            </a>
          </Card>
        </aside>
      </div>
    </article>
  );
}

function NodePayload({ version }: { version: PublicNodeVersion }) {
  switch (version.kind) {
    case "claim":
      return (
        <>
          <p className="node-preserved-text">{version.payload.statement}</p>
          {version.payload.qualifiers.length > 0 ? (
            <>
              <h3>Qualifiers</h3>
              <ul>
                {version.payload.qualifiers.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      );
    case "figure":
      return (
        <DefinitionList
          items={[
            { term: "Caption", value: version.payload.caption },
            {
              term: "Alternative text",
              value: version.payload.altText ?? <span className="muted">Not declared</span>,
            },
            {
              term: "Repository artifact",
              value: <span className="mono">{version.payload.artifactPath}</span>,
            },
          ]}
        />
      );
    case "dataset":
      return (
        <DefinitionList
          items={[
            { term: "Format", value: version.payload.format },
            { term: "Size", value: formatBytes(version.payload.sizeBytes) },
            {
              term: "Repository artifact",
              value: version.payload.artifactPath ? (
                <span className="mono">{version.payload.artifactPath}</span>
              ) : (
                <span className="muted">External dataset</span>
              ),
            },
          ]}
        />
      );
    case "code":
      return (
        <>
          <DefinitionList
            items={[
              { term: "Language", value: version.payload.language },
              {
                term: "Release",
                value: <span className="mono">{version.payload.releaseRef}</span>,
              },
            ]}
          />
          <h3>Entry points</h3>
          <ul>
            {version.payload.entryPoints.map((path) => (
              <li className="mono" key={path}>
                {path}
              </li>
            ))}
          </ul>
        </>
      );
  }
}

function kindLabel(kind: PublicNodeDetail["kind"]): string {
  return kind === "code" ? "Code" : `${kind[0]!.toUpperCase()}${kind.slice(1)}`;
}

type NodeEdgeTrustAssessment = NonNullable<
  PublicNodeDetail["edges"][number]["trustAssessments"]
>[number];

export function nodeEdgeTrustAssessments(
  edge: PublicNodeDetail["edges"][number],
): NodeEdgeTrustAssessment[] {
  if (edge.trustAssessments) return edge.trustAssessments;
  if (!edge.trust) return [];
  return [
    {
      ...edge.trust,
      assessorType: "not supplied (legacy)",
      criteria: missingTrustCriterionProfile(),
    },
  ];
}

type NodeContextTrustAssessment = NonNullable<
  PublicNodeDetail["trustContext"][number]["trustAssessments"]
>[number];

export function nodeContextTrustAssessments(
  context: PublicNodeDetail["trustContext"][number],
): NodeContextTrustAssessment[] {
  if (context.trustAssessments) return context.trustAssessments;
  if (!context.trust) return [];
  return [
    {
      ...context.trust,
      assessmentId: `legacy:${context.claimId}:${context.citationId}`,
      protocolVersion: "not supplied (legacy)",
      assessorType: "not supplied (legacy)",
      criteria: missingTrustCriterionProfile(),
    },
  ];
}

function missingTrustCriterionProfile() {
  return TRUST_CRITERIA.map((criterion) => ({
    criterion,
    rating: "not-supplied" as const,
    status: "not-supplied" as const,
  }));
}

function formatBytes(value: number): string {
  if (value < 1_000) return `${value} bytes`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} kB`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  return `${(value / 1_000_000_000).toFixed(1)} GB`;
}
