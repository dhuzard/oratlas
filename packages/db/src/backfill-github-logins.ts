import { getPrisma } from "./index.js";
import {
  planGithubLoginNormalization,
  type LoginNormalizationConflict,
} from "./github-login-normalization.js";

class BackfillConflictError extends Error {
  constructor(readonly conflicts: LoginNormalizationConflict[]) {
    super("GitHub login normalization conflicts require manual resolution.");
  }
}

const prisma = getPrisma();

async function main(): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const users = await tx.user.findMany({
      select: { id: true, githubLogin: true, githubLoginNormalized: true },
    });
    const plan = planGithubLoginNormalization(users);
    if (plan.conflicts.length > 0) throw new BackfillConflictError(plan.conflicts);

    for (const update of plan.updates) {
      await tx.user.update({
        where: { id: update.id },
        data: { githubLoginNormalized: update.githubLoginNormalized },
      });
    }
    return plan.updates.length;
  });
}

try {
  const count = await main();
  console.info(`Backfilled normalized GitHub logins for ${count} user(s).`);
} catch (error) {
  if (error instanceof BackfillConflictError) {
    console.error("Backfill aborted without writes. Resolve these accounts manually:");
    for (const conflict of error.conflicts) {
      console.error(
        `- ${conflict.reason}: ${conflict.githubLogins.join(", ")} [${conflict.userIds.join(", ")}]`,
      );
    }
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await prisma.$disconnect();
}
