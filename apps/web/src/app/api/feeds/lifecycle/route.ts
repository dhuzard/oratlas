import { NextResponse } from "next/server";
import { isExactCommitSha } from "@oratlas/contracts";
import { appBaseUrl } from "@/lib/base-url";
import { prisma } from "@/lib/db";
import { handleRouteError } from "@/lib/api";
import { lifecycleEventDto } from "@/lib/review-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Machine-readable correction, withdrawal and tombstone ledger. */
export async function GET() {
  try {
    const rows = await prisma.reviewLifecycleEvent.findMany({
      where: {
        review: { status: "published" },
        reviewVersion: { publishedAt: { not: null } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        actor: true,
        review: { select: { slug: true } },
        reviewVersion: { select: { snapshot: { select: { commitSha: true } } } },
      },
    });
    const base = appBaseUrl();
    const events = rows
      .filter((row) => isExactCommitSha(row.reviewVersion.snapshot.commitSha))
      .map((row) => ({
        ...lifecycleEventDto(row),
        reviewSlug: row.review.slug,
        commitSha: row.reviewVersion.snapshot.commitSha,
        url: `${base}/reviews/${row.review.slug}/versions/${row.reviewVersionId}`,
      }));
    return NextResponse.json(
      {
        schemaVersion: "1.0.0",
        generatedAt: new Date().toISOString(),
        events,
      },
      {
        headers: {
          "Cache-Control": "no-store, must-revalidate",
          Pragma: "no-cache",
        },
      },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
