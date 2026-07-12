import { NextResponse } from "next/server";
import { atomFeed, type FeedEntryInput } from "@oratlas/exports";
import { isExactCommitSha } from "@oratlas/contracts";
import { appBaseUrl } from "@/lib/base-url";
import { prisma } from "@/lib/db";
import { handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FEED_LIMIT = 50;

/** Atom feed of recently accepted review versions, served from the archive. */
export async function GET() {
  try {
    const base = appBaseUrl();
    const versions = await prisma.reviewVersion.findMany({
      where: {
        publishedAt: { not: null },
        // Withdrawals are published in the lifecycle ledger, not as ordinary
        // accepted content in this discovery feed.
        publicState: "published",
        review: { status: "published" },
      },
      orderBy: { publishedAt: "desc" },
      take: FEED_LIMIT,
      select: {
        id: true,
        title: true,
        abstract: true,
        publishedAt: true,
        review: { select: { slug: true } },
        snapshot: { select: { commitSha: true } },
        contributors: {
          select: { person: { select: { displayName: true } } },
          orderBy: { position: "asc" },
        },
      },
    });
    const entries: FeedEntryInput[] = versions
      .filter((version) => isExactCommitSha(version.snapshot.commitSha))
      .map((version) => {
        const url = `${base}/reviews/${version.review.slug}/versions/${version.id}`;
        return {
          id: url,
          title: version.title,
          url,
          updated: version.publishedAt!.toISOString(),
          summary: version.abstract ?? undefined,
          authors: version.contributors.map((contributor) => contributor.person.displayName),
        };
      });
    const updated = entries[0]?.updated ?? new Date(0).toISOString();
    const xml = atomFeed({
      id: `${base}/api/feeds/atom`,
      title: "Open Review Atlas — recently accepted reviews",
      siteUrl: `${base}/archive`,
      feedUrl: `${base}/api/feeds/atom`,
      updated,
      entries,
    });
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/atom+xml; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
