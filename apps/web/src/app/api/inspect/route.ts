import { NextResponse } from "next/server";
import { z } from "zod";
import { repoSourceSelectionSchema, resolveEffectiveMetadata } from "@oratlas/contracts";
import { getServerEnv, requireUser } from "@/lib/auth";
import { inspectAndExtract, normalizeRepoUrl, buildValidationReport } from "@/lib/ingest";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import { rateLimit, clientKey } from "@/lib/rate-limit";
import { validateSameOriginJsonRequest } from "@/lib/mutation-request";
import { createInspectionCapture } from "@/lib/inspection-captures";
import { derivePublicationTargets } from "@/lib/submission-payload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  url: z.string().min(1).max(2048),
  source: repoSourceSelectionSchema,
});

/** Inspect a repository URL and return extracted metadata + compatibility + validation. */
export async function POST(request: Request) {
  try {
    const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
    if (!integrity.ok)
      return NextResponse.json(
        {
          error: {
            code: integrity.status === 415 ? "bad-request" : "forbidden",
            message: integrity.message,
          },
        },
        { status: integrity.status },
      );
    const user = await requireUser();
    const limit = rateLimit(clientKey(request.headers, `inspect:${user.id}`), 20, 60_000);
    if (!limit.ok)
      return errorResponse("rate-limited", "Too many inspection requests. Try again shortly.");

    const body = await readJsonBody(request);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return errorResponse("bad-request", "A repository URL is required.");

    const normalized = normalizeRepoUrl(parsed.data.url);
    if (!normalized.ok) return errorResponse("bad-request", normalized.reason);

    const outcome = await inspectAndExtract(normalized.ref.canonicalUrl, parsed.data.source);
    if (outcome.report.status === "failed" || !outcome.report.selectedSource) {
      return errorResponse("upstream-error", outcome.report.error ?? "Inspection failed.");
    }
    const hasEvidence =
      outcome.extraction.knowledge.claims.length > 0 &&
      outcome.extraction.knowledge.citations.length > 0;
    const hasTrust = outcome.extraction.knowledge.trust.length > 0;
    const validNodeCount = outcome.extraction.nodeExtraction.nodes.filter(
      (record) => record.status === "ok" && Boolean(record.node),
    ).length;
    const publicationTargets = derivePublicationTargets(
      outcome.compatibility.reviewContentDetected.detected,
      outcome.extraction.manifestPresent,
      outcome.extraction.knowledge.claims.length,
      outcome.extraction.knowledge.citations.length,
      validNodeCount,
    );
    const validation = await buildValidationReport(
      outcome.report,
      outcome.compatibility,
      outcome.extractedMetadata,
      undefined,
      hasEvidence,
      hasTrust,
      publicationTargets.knowledgeNodes,
    );
    const effective = resolveEffectiveMetadata(outcome.extractedMetadata, undefined);
    const capture = await createInspectionCapture(
      user.id,
      outcome.report,
      outcome.extraction,
      validation,
    );

    return NextResponse.json({
      repo: outcome.report.repo,
      selectedSource: outcome.report.selectedSource,
      captureToken: capture.token,
      captureExpiresAt: capture.expiresAt,
      capturePayloadHash: capture.payloadHash,
      inspectionStatus: outcome.report.status,
      inspectionWarnings: outcome.report.warnings,
      inspectionError: outcome.report.error,
      extractedMetadata: outcome.extractedMetadata,
      effectiveMetadata: effective,
      compatibility: outcome.compatibility,
      validation,
      knowledgeCounts: {
        claims: outcome.extraction.knowledge.claims.length,
        citations: outcome.extraction.knowledge.citations.length,
        relations: outcome.extraction.knowledge.relations.length,
        trust: outcome.extraction.knowledge.trust.length,
      },
      nodeExtraction: outcome.extraction.nodeExtraction,
      publicationTargets,
    });
  } catch (err) {
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(err);
  }
}
