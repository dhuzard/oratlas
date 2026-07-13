import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { listNotifications, markNotificationRead } from "@/lib/editorial-lifecycle";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** List the signed-in user's notifications (newest first, max 100). */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const unreadOnly = new URL(request.url).searchParams.get("unread") === "1";
    return NextResponse.json({ notifications: await listNotifications(user.id, unreadOnly) });
  } catch (err) {
    return handleRouteError(err);
  }
}

const bodySchema = z.object({ notificationId: z.string().min(1) });

/** Mark one of the signed-in user's notifications as read. */
export async function POST(request: Request) {
  return handleLifecyclePost(request, bodySchema, async (actor, body) => {
    await markNotificationRead(actor.id, body.notificationId);
    return { status: "read" };
  });
}
