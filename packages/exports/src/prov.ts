/**
 * W3C PROV provenance for one immutable version, serialized as JSON-LD with
 * explicit prov: terms. The chain mirrors the platform's actual pipeline:
 * repository state → inspection capture → submission → accepted version.
 * Agents are referenced by public login only.
 */

export interface ProvExportInput {
  canonicalUrl: string;
  versionId: string;
  title: string;
  repositoryUrl: string;
  commitSha: string;
  treeSha?: string;
  capture?: {
    payloadHash: string;
    capturedAt?: string;
  };
  submission?: {
    id: string;
    submittedAt?: string;
    submitterLogin?: string;
  };
  acceptance: {
    publishedAt?: string;
    editorLogin?: string;
  };
}

type JsonLdEntity = Record<string, unknown>;

export function provJsonLd(input: ProvExportInput): {
  "@context": Record<string, string>;
  "@graph": JsonLdEntity[];
} {
  const graph: JsonLdEntity[] = [];
  const versionId = `${input.canonicalUrl}#version`;
  const sourceId = `${input.repositoryUrl}/commit/${input.commitSha}`;

  const source: JsonLdEntity = {
    "@id": sourceId,
    "@type": "prov:Entity",
    "rdfs:label": `Repository state ${input.commitSha}`,
    "prov:atLocation": input.repositoryUrl,
  };
  if (input.treeSha) source["oratlas:treeSha"] = input.treeSha;
  graph.push(source);

  let derivedFrom = sourceId;
  if (input.capture) {
    const captureId = `${input.canonicalUrl}#capture`;
    const inspectionId = `${input.canonicalUrl}#inspection`;
    const capture: JsonLdEntity = {
      "@id": captureId,
      "@type": "prov:Entity",
      "rdfs:label": "Append-only inspection capture",
      "oratlas:payloadSha256": input.capture.payloadHash,
      "prov:wasDerivedFrom": { "@id": sourceId },
      "prov:wasGeneratedBy": { "@id": inspectionId },
    };
    graph.push(capture);
    const inspection: JsonLdEntity = {
      "@id": inspectionId,
      "@type": "prov:Activity",
      "rdfs:label": "Repository inspection",
      "prov:used": { "@id": sourceId },
    };
    if (input.capture.capturedAt) inspection["prov:endedAtTime"] = input.capture.capturedAt;
    graph.push(inspection);
    derivedFrom = captureId;
  }

  if (input.submission) {
    const submissionId = `${input.canonicalUrl}#submission`;
    const submissionEntity: JsonLdEntity = {
      "@id": submissionId,
      "@type": "prov:Entity",
      "rdfs:label": `Submission ${input.submission.id}`,
      "prov:wasDerivedFrom": { "@id": derivedFrom },
    };
    if (input.submission.submittedAt) {
      submissionEntity["prov:generatedAtTime"] = input.submission.submittedAt;
    }
    if (input.submission.submitterLogin) {
      const submitterId = `${input.canonicalUrl}#submitter`;
      submissionEntity["prov:wasAttributedTo"] = { "@id": submitterId };
      graph.push({
        "@id": submitterId,
        "@type": "prov:Agent",
        "rdfs:label": input.submission.submitterLogin,
      });
    }
    graph.push(submissionEntity);
    derivedFrom = submissionId;
  }

  const acceptanceId = `${input.canonicalUrl}#acceptance`;
  const versionEntity: JsonLdEntity = {
    "@id": versionId,
    "@type": "prov:Entity",
    "rdfs:label": input.title,
    "prov:atLocation": input.canonicalUrl,
    "prov:wasDerivedFrom": { "@id": derivedFrom },
    "prov:wasGeneratedBy": { "@id": acceptanceId },
  };
  if (input.acceptance.publishedAt) {
    versionEntity["prov:generatedAtTime"] = input.acceptance.publishedAt;
  }
  graph.push(versionEntity);

  const acceptance: JsonLdEntity = {
    "@id": acceptanceId,
    "@type": "prov:Activity",
    "rdfs:label": "Editorial acceptance and atomic publication",
  };
  if (input.acceptance.publishedAt) acceptance["prov:endedAtTime"] = input.acceptance.publishedAt;
  if (input.acceptance.editorLogin) {
    const editorId = `${input.canonicalUrl}#editor`;
    acceptance["prov:wasAssociatedWith"] = { "@id": editorId };
    graph.push({
      "@id": editorId,
      "@type": "prov:Agent",
      "rdfs:label": input.acceptance.editorLogin,
    });
  }
  graph.push(acceptance);

  return {
    "@context": {
      prov: "http://www.w3.org/ns/prov#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      oratlas: `${new URL(input.canonicalUrl).origin}/ns#`,
    },
    "@graph": graph,
  };
}
