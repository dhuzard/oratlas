export interface CanonicalBindingValidation {
  missingReviewBinding: number;
  missingReviewVersionBinding: number;
  missingClaimBindings: number;
  missingReviewAssertionBindings: number;
  missingCitationBindings: number;
  missingRelationBindings: number;
  semanticMismatchCount: number;
}

export interface ClaimBinding {
  id: string;
  knowledgeNodeId: string | null;
  graphVersion: { id: string } | null;
}

export interface ReviewAssertionBinding {
  edgeDiscriminator: string;
  targetNodeId: string;
  confirmedTargetNodeVersionId: string | null;
  confirmedById: string | null;
}

export function countMissingReviewAssertions(
  claims: readonly ClaimBinding[],
  assertions: readonly ReviewAssertionBinding[],
): number {
  return claims.filter(
    (claim) =>
      claim.knowledgeNodeId !== null &&
      claim.graphVersion !== null &&
      !assertions.some(
        (edge) =>
          edge.edgeDiscriminator === claim.id &&
          edge.targetNodeId === claim.knowledgeNodeId &&
          edge.confirmedTargetNodeVersionId === claim.graphVersion?.id &&
          edge.confirmedById === null,
      ),
  ).length;
}

export function canonicalValidationTotal(validation: CanonicalBindingValidation): number {
  return (
    validation.missingReviewBinding +
    validation.missingReviewVersionBinding +
    validation.missingClaimBindings +
    validation.missingReviewAssertionBindings +
    validation.missingCitationBindings +
    validation.missingRelationBindings +
    validation.semanticMismatchCount
  );
}
