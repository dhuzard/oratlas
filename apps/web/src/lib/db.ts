import "server-only";
import { getPrisma, parseJsonColumn } from "@oratlas/db";

export const prisma = getPrisma();
export { parseJsonColumn };
