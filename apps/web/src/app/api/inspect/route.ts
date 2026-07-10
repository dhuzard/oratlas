import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveEffectiveMetadata } from "@oratlas/contracts";
import { getCurrentUser } from "@/lib/auth";
import { inspectAndExtract, normalizeRepoUrl, buildValidationReport } from "@/lib/ingest";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import { rateLimit, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ url: z.string().min(1).max(2048) });

/** Inspect a repository URL and return extracted metadata + compatibility + validation. */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    const limit = rateLimit(
      clientKey(request.headers, `inspect:${user?.id ?? "anon"}`),
      20,
      60_000,
    );
    if (!limit.ok)
      return errorResponse("rate-limited", "Too many inspection requests. Try again shortly.");

    const body = await readJsonBody(request);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return errorResponse("bad-request", "A repository URL is required.");

    const normalized = normalizeRepoUrl(parsed.data.url);
    if (!normalized.ok) return errorResponse("bad-request", normalized.reason);

    const outcome = await inspectAndExtract(normalized.ref.canonicalUrl);
    const hasEvidence =
      outcome.extraction.knowledge.claims.length > 0 &&
      outcome.extraction.knowledge.citations.length > 0;
    const hasTrust = outcome.extraction.knowledge.trust.length > 0;
    const validation = await buildValidationReport(
      outcome.report,
      outcome.compatibility,
      outcome.extractedMetadata,
      undefined,
      hasEvidence,
      hasTrust,
    );
    const effective = resolveEffectiveMetadata(outcome.extractedMetadata, undefined);

    return NextResponse.json({
      repo: normalized.ref,
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
    });
  } catch (err) {
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(err);
  }
}
