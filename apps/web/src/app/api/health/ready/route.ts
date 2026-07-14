import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ready", checks: { database: "ok" } });
  } catch (err) {
    logger.error("readiness check failed", { error: err });
    // Do not leak internal error details to the response body.
    return NextResponse.json(
      { status: "unavailable", checks: { database: "error" } },
      { status: 503 },
    );
  }
}
