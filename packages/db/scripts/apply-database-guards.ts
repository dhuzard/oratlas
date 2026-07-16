import { getPrisma } from "../src/index.js";
import { applyDatabaseGuards } from "../src/database-guards.js";

const client = getPrisma();
const provider = /^postgres(?:ql)?:/i.test(process.env.DATABASE_URL ?? "")
  ? "postgresql"
  : "sqlite";

try {
  await applyDatabaseGuards(client, provider);
  console.info(`[database-guards] applied ${provider} guards`);
} finally {
  await client.$disconnect();
}
