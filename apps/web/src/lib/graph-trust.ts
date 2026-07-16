import { type PublicGraphEdge } from "@oratlas/contracts";

export interface GraphTrustLookupKey {
  sourceVersionId: string;
  targetVersionId: string;
  relationType: PublicGraphEdge["relationType"];
}

export interface GraphTrustProvider {
  lookup(keys: readonly GraphTrustLookupKey[]): Promise<ReadonlyMap<string, unknown>>;
}

export function graphTrustLookupKey(key: GraphTrustLookupKey): string {
  return JSON.stringify([key.sourceVersionId, key.targetVersionId, key.relationType]);
}

export const emptyGraphTrustProvider: GraphTrustProvider = {
  async lookup() {
    return new Map();
  },
};
