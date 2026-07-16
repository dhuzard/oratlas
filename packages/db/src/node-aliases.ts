import { canonicalizeNodeAlias } from "@oratlas/contracts";
import type { PrismaClient } from "../generated/client/index.js";

type NodeAliasClient = Pick<PrismaClient, "nodeAlias">;

export interface UpsertNodeAliasInput {
  knowledgeNodeId: string;
  alias: unknown;
}

/**
 * Canonical persistence boundary for node aliases. Equivalent resolver/prefix
 * representations converge on the same compound key; semantic marker drift
 * fails closed instead of rewriting the existing alias.
 */
export async function upsertNodeAlias(client: NodeAliasClient, input: UpsertNodeAliasInput) {
  const alias = canonicalizeNodeAlias(input.alias);
  if (!alias) throw new Error("Cannot persist an invalid knowledge-node alias.");

  const row = await client.nodeAlias.upsert({
    where: {
      knowledgeNodeId_scheme_role_value: {
        knowledgeNodeId: input.knowledgeNodeId,
        scheme: alias.scheme,
        role: alias.role,
        value: alias.value,
      },
    },
    create: {
      knowledgeNodeId: input.knowledgeNodeId,
      scheme: alias.scheme,
      role: alias.role,
      value: alias.value,
      isExample: alias.isExample,
    },
    update: {},
  });
  if (row.isExample !== alias.isExample) {
    throw new Error("Cannot persist a node alias with conflicting example provenance.");
  }
  return row;
}
