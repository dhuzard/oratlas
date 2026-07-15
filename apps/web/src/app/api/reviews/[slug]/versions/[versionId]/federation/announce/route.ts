import { NextResponse } from "next/server";
import { z } from "zod";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { prepareVersionReviewAnnouncement } from "@/lib/federation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z
  .object({
    inReplyTo: z.string().url().max(2_048),
  })
  .strict();

/** Prepare and audit (but never deliver) a reply to an accepted Request Review. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; versionId: string }> },
) {
  const { slug, versionId } = await params;
  return handleLifecyclePost(
    request,
    querySchema,
    async (actor, input) => {
      const payload = await prepareVersionReviewAnnouncement(
        actor,
        slug,
        versionId,
        input.inReplyTo,
      );
      return NextResponse.json(payload, {
        headers: {
          "Content-Type": "application/ld+json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    },
    "federation-announcement",
  );
}
