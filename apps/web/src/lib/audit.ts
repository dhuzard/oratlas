import "server-only";
import { prisma } from "./db";

/** Append an audit event (spec §9, §17). Never throws into the caller path. */
export async function audit(
  actorId: string | null,
  action: string,
  subjectType: string,
  subjectId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actorId: actorId ?? undefined,
        action,
        subjectType,
        subjectId,
        detailsJson: JSON.stringify(details),
      },
    });
  } catch (err) {
    console.error("[audit] failed to write event", action, err);
  }
}
