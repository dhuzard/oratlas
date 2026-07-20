/**
 * DocMaps-compatible serialization of a version's editorial process history
 * (issue #6). One step per event group: submission, each formal review round
 * (reports + author responses + decision letter), and final publication.
 * Pure data mapping over stored rows; attributable by public login only.
 */

export interface DocmapReportInput {
  reviewerLogin: string;
  /** ORCID snapshot; only emitted as an identifier when verified. */
  reviewerOrcid?: string;
  orcidVerified: boolean;
  recommendation: string;
  submittedAt: string;
}

export interface DocmapRoundInput {
  roundNumber: number;
  openedAt: string;
  reports: DocmapReportInput[];
  responses: Array<{ authorLogin: string; submittedAt: string }>;
  decision?: { editorLogin: string; decision: string; issuedAt: string };
}

export interface DocmapInput {
  platformVersion: string;
  /** Stable docmap IRI (the export URL). */
  id: string;
  publisherName: string;
  publisherUrl: string;
  /** Canonical Atlas URL of the immutable version the map describes. */
  versionUrl: string;
  versionDoi?: string;
  /** Example versions never emit DOIs as machine-actionable identifiers. */
  isExample: boolean;
  created: string;
  updated: string;
  submission: { submittedAt?: string; submitterLogin?: string };
  rounds: DocmapRoundInput[];
  /** Set when the version was accepted and published. */
  publishedAt?: string;
}

type JsonObject = Record<string, unknown>;

function person(name: string, orcid?: string): JsonObject {
  const actor: JsonObject = { type: "person", name };
  if (orcid) actor.id = `https://orcid.org/${orcid}`;
  return actor;
}

function versionExpression(input: DocmapInput): JsonObject {
  const expression: JsonObject = { type: "preprint", url: input.versionUrl };
  if (input.versionDoi && !input.isExample) expression.doi = input.versionDoi;
  return expression;
}

export function docmap(input: DocmapInput): JsonObject {
  const steps: Record<string, JsonObject> = {};
  const stepIds: string[] = [];
  const addStep = (step: JsonObject) => {
    const id = `_:b${stepIds.length}`;
    stepIds.push(id);
    steps[id] = step;
  };

  addStep({
    actions: [
      {
        participants: input.submission.submitterLogin
          ? [{ actor: person(input.submission.submitterLogin), role: "author" }]
          : [],
        outputs: [
          {
            ...versionExpression(input),
            ...(input.submission.submittedAt ? { published: input.submission.submittedAt } : {}),
          },
        ],
      },
    ],
    assertions: [{ item: input.versionUrl, status: "submitted" }],
  });

  for (const round of input.rounds) {
    const actions: JsonObject[] = round.reports.map((report) => ({
      participants: [
        {
          actor: person(
            report.reviewerLogin,
            report.orcidVerified ? report.reviewerOrcid : undefined,
          ),
          role: "peer-reviewer",
        },
      ],
      outputs: [
        {
          type: "review",
          published: report.submittedAt,
          recommendation: report.recommendation,
        },
      ],
    }));
    for (const response of round.responses) {
      actions.push({
        participants: [{ actor: person(response.authorLogin), role: "author" }],
        outputs: [{ type: "author-response", published: response.submittedAt }],
      });
    }
    if (round.decision) {
      actions.push({
        participants: [{ actor: person(round.decision.editorLogin), role: "editor" }],
        outputs: [
          {
            type: "decision-letter",
            published: round.decision.issuedAt,
            decision: round.decision.decision,
          },
        ],
      });
    }
    addStep({
      actions,
      assertions: [
        {
          item: input.versionUrl,
          status: round.decision ? `decision:${round.decision.decision}` : "under-review",
        },
      ],
      "round-number": round.roundNumber,
    });
  }

  if (input.publishedAt) {
    addStep({
      actions: [
        {
          participants: [],
          outputs: [{ ...versionExpression(input), published: input.publishedAt }],
        },
      ],
      assertions: [{ item: input.versionUrl, status: "published" }],
    });
  }

  for (let i = 0; i < stepIds.length - 1; i += 1) {
    steps[stepIds[i]!]!["next-step"] = stepIds[i + 1];
    steps[stepIds[i + 1]!]!["previous-step"] = stepIds[i];
  }

  return {
    "@context": "https://w3id.org/docmaps/context.jsonld",
    type: "docmap",
    id: input.id,
    publisher: {
      name: input.publisherName,
      url: input.publisherUrl,
      "platform-version": input.platformVersion,
    },
    created: input.created,
    updated: input.updated,
    "first-step": stepIds[0],
    steps,
  };
}
