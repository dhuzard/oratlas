-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "githubUserId" TEXT,
    "githubLogin" TEXT NOT NULL,
    "githubLoginNormalized" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "profileUrl" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "orcid" TEXT,
    "orcidVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL DEFAULT 'github.com',
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "githubRepositoryId" TEXT,
    "defaultBranch" TEXT,
    "description" TEXT,
    "licenseSpdx" TEXT,
    "topicsJson" TEXT NOT NULL DEFAULT '[]',
    "homepageUrl" TEXT,
    "pagesUrl" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastInspectedAt" TIMESTAMP(3),

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositorySnapshot" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "branch" TEXT,
    "releaseTag" TEXT,
    "releaseUrl" TEXT,
    "sourceCreatedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspectionStatus" TEXT NOT NULL,
    "inspectionReportJson" TEXT NOT NULL,
    "sourceTreeSha" TEXT,
    "sourceKind" TEXT,
    "manifestJson" TEXT,
    "preservedFilesJson" TEXT,
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "RepositorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "repositoryId" TEXT,
    "currentSnapshotId" TEXT,
    "synthesisSeriesKey" TEXT,
    "currentSynthesisVersionId" TEXT,
    "title" TEXT NOT NULL,
    "abstract" TEXT,
    "reviewType" TEXT,
    "licenseSpdx" TEXT,
    "publishedReviewUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lifecycleRevision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewVersion" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "recordSourceType" TEXT NOT NULL DEFAULT 'repository',
    "synthesisDraftId" TEXT,
    "sourceSubmissionId" TEXT,
    "inspectionCaptureId" TEXT,
    "sourceKind" TEXT,
    "sourceBranch" TEXT,
    "sourceSelectionKey" TEXT,
    "tagObjectSha" TEXT,
    "sourceCreatedAt" TIMESTAMP(3),
    "semanticVersion" TEXT,
    "title" TEXT NOT NULL,
    "abstract" TEXT,
    "metadataJson" TEXT NOT NULL,
    "versionDoi" TEXT,
    "conceptDoi" TEXT,
    "zenodoRecordId" TEXT,
    "releaseTag" TEXT,
    "releaseUrl" TEXT,
    "publicationConsistencyJson" TEXT,
    "capturePayloadHash" TEXT,
    "isExample" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicState" TEXT NOT NULL DEFAULT 'published',
    "synthesisDocumentJson" TEXT,
    "synthesisOrdinal" INTEGER,
    "synthesisGenerationMode" TEXT,
    "synthesisPipelineName" TEXT,
    "synthesisPipelineId" TEXT,
    "synthesisPipelineKind" TEXT,
    "synthesisPipelineVersion" TEXT,
    "synthesisProvider" TEXT,
    "synthesisModel" TEXT,
    "synthesisModelVersion" TEXT,
    "synthesisPromptVersion" TEXT,
    "synthesisPromptHash" TEXT,
    "synthesisPacketHash" TEXT,
    "synthesisDocumentHash" TEXT,
    "synthesisGeneratedAt" TIMESTAMP(3),
    "synthesisAcceptedAt" TIMESTAMP(3),
    "synthesisApprovedById" TEXT,
    "synthesisApproverRole" TEXT,
    "synthesisApproverDisplayName" TEXT,
    "synthesisApproverGithubLogin" TEXT,
    "synthesisChecklistVersion" TEXT,
    "synthesisAttributionPolicyVersion" TEXT,
    "synthesisMaterializationPolicyVersion" TEXT,
    "synthesisRightsStatement" TEXT,
    "synthesisLicenseSpdx" TEXT,
    "acceptedPredecessorVersionId" TEXT,

    CONSTRAINT "ReviewVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewLifecycleEvent" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reviewVersionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "supersedesVersionId" TEXT,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionCapture" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "githubRepositoryId" TEXT NOT NULL,
    "canonicalUrlAtCapture" TEXT NOT NULL,
    "inspectedByUserId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "releaseTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "InspectionCapture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "givenName" TEXT,
    "familyName" TEXT,
    "orcid" TEXT,
    "githubLogin" TEXT,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewContributor" (
    "reviewVersionId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "rolesJson" TEXT NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL,

    CONSTRAINT "ReviewContributor_pkey" PRIMARY KEY ("reviewVersionId","personId")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "inspectionCaptureId" TEXT,
    "sourceKind" TEXT,
    "sourceBranch" TEXT,
    "sourceSelectionKey" TEXT,
    "releaseTag" TEXT,
    "releaseUrl" TEXT,
    "tagObjectSha" TEXT,
    "sourceCreatedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "extractedMetadataJson" TEXT,
    "editedMetadataJson" TEXT,
    "validationReportJson" TEXT,
    "submittedPayloadJson" TEXT,
    "submittedPayloadHash" TEXT,
    "acceptedNodeSelectionJson" TEXT,
    "acceptedNodeSelectionHash" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewerId" TEXT,
    "editorialNote" TEXT,
    "publicationConsistencyJson" TEXT,
    "resultingReviewId" TEXT,
    "resultingReviewVersionId" TEXT,
    "previousSubmissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialOverride" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "editorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorialOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Identifier" (
    "id" TEXT NOT NULL,
    "reviewVersionId" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "url" TEXT,
    "relationType" TEXT NOT NULL,
    "validationStatus" TEXT NOT NULL DEFAULT 'unvalidated',
    "validationReportJson" TEXT,
    "isExample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Identifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "reviewVersionId" TEXT NOT NULL,
    "knowledgeNodeId" TEXT,
    "localClaimId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "section" TEXT,
    "anchor" TEXT,
    "claimType" TEXT,
    "qualification" TEXT,
    "scopeJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeNode" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "localNodeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeNodeVersion" (
    "id" TEXT NOT NULL,
    "knowledgeNodeId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "sourceSubmissionId" TEXT,
    "inspectionCaptureId" TEXT,
    "capturePayloadHash" TEXT,
    "title" TEXT NOT NULL,
    "abstract" TEXT,
    "text" TEXT,
    "contributorsJson" TEXT NOT NULL DEFAULT '[]',
    "license" TEXT NOT NULL,
    "provenanceJson" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "versionDoi" TEXT,
    "conceptDoi" TEXT,
    "isExample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeNodeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeEdge" (
    "id" TEXT NOT NULL,
    "sourceNodeVersionId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "rationale" TEXT,
    "assertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedTargetNodeVersionId" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NodeEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeEdgeProposal" (
    "id" TEXT NOT NULL,
    "originKey" TEXT NOT NULL,
    "sourceStableKey" TEXT NOT NULL,
    "targetStableKey" TEXT NOT NULL,
    "sourceNodeVersionId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "targetNodeVersionId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "rationale" TEXT,
    "evidenceJson" TEXT NOT NULL DEFAULT '{}',
    "sourceSubmissionId" TEXT,
    "inspectionCaptureId" TEXT,
    "agentRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "confirmedEdgeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeEdgeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeAlias" (
    "id" TEXT NOT NULL,
    "knowledgeNodeId" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isExample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeIdentityProposal" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "signalsJson" TEXT NOT NULL,
    "sharedAliasesJson" TEXT NOT NULL DEFAULT '[]',
    "sourceTextHash" TEXT,
    "targetTextHash" TEXT,
    "textSimilarity" DOUBLE PRECISION,
    "methodVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeIdentityProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplicationBrief" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "scopeJson" TEXT NOT NULL,
    "expectedInformationGain" TEXT NOT NULL,
    "effortBand" TEXT NOT NULL,
    "protocolUrl" TEXT,
    "citationUrlsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "triageSnapshotJson" TEXT,
    "createdById" TEXT NOT NULL,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "claimNote" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "completionUrl" TEXT,
    "completionSummary" TEXT,
    "withdrawnById" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplicationBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplicationBriefClaim" (
    "replicationBriefId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ReplicationBriefClaim_pkey" PRIMARY KEY ("replicationBriefId","claimId")
);

-- CreateTable
CREATE TABLE "ExecutionPassport" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'execution-attested',
    "verificationStatus" TEXT NOT NULL DEFAULT 'verified',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "sourceJson" TEXT NOT NULL,
    "crateSha256" TEXT NOT NULL,
    "attestationSha256" TEXT NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "repositoryUrl" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "treeSha" TEXT NOT NULL,
    "workflowEntityId" TEXT NOT NULL,
    "workflowPath" TEXT NOT NULL,
    "workflowSha256" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "workflowRunAttempt" INTEGER NOT NULL,
    "signingKeyId" TEXT NOT NULL,
    "signingIssuer" TEXT NOT NULL,
    "signingSubject" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "registeredById" TEXT NOT NULL,
    "lastVerifiedById" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionPassport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionPassportClaim" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,

    CONSTRAINT "ExecutionPassportClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionPassportArtifact" (
    "id" TEXT NOT NULL,
    "passportId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mediaType" TEXT,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,

    CONSTRAINT "ExecutionPassportArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" TEXT NOT NULL,
    "reviewVersionId" TEXT NOT NULL,
    "localCitationId" TEXT NOT NULL,
    "doi" TEXT,
    "pmid" TEXT,
    "openAlexId" TEXT,
    "title" TEXT,
    "authorsJson" TEXT NOT NULL DEFAULT '[]',
    "year" INTEGER,
    "source" TEXT,
    "url" TEXT,
    "datasetIdsJson" TEXT NOT NULL DEFAULT '[]',
    "derivedFromJson" TEXT NOT NULL DEFAULT '[]',
    "rawCitationJson" TEXT,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvidenceRelation" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "citationId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "supportDirection" TEXT,
    "sourceLocation" TEXT,
    "extractionMethod" TEXT,
    "extractionConfidence" DOUBLE PRECISION,
    "humanReviewed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ClaimEvidenceRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustAssessment" (
    "id" TEXT NOT NULL,
    "claimEvidenceRelationId" TEXT NOT NULL,
    "protocolVersion" TEXT NOT NULL,
    "assessorType" TEXT NOT NULL,
    "assessorId" TEXT,
    "assessedAt" TIMESTAMP(3),
    "identityIntegrity" TEXT,
    "entailment" TEXT,
    "sourceAccess" TEXT,
    "populationRelevance" TEXT,
    "interventionExposureRelevance" TEXT,
    "outcomeRelevance" TEXT,
    "methodologicalSafeguards" TEXT,
    "statisticalSafeguards" TEXT,
    "replicationConvergence" TEXT,
    "conflictDependency" TEXT,
    "limitationsJson" TEXT NOT NULL DEFAULT '[]',
    "evidenceJson" TEXT,
    "aggregateScore" DOUBLE PRECISION,
    "aggregateMethod" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'unverified-import',
    "adjudicatorId" TEXT,
    "adjudicatedAt" TIMESTAMP(3),
    "sourceRecordJson" TEXT,
    "sourceReviewStatus" TEXT,
    "sourceAssessorType" TEXT,
    "sourceAssessorId" TEXT,
    "sourceAssessedAt" TIMESTAMP(3),
    "sourceEvidenceJson" TEXT,
    "sourceAggregateScore" DOUBLE PRECISION,
    "sourceAggregateMethod" TEXT,
    "sourceRelationHumanReviewed" BOOLEAN,
    "sourceRecordHash" TEXT,
    "sourceLineageKey" TEXT,
    "supersedesAssessmentId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "reviewVersionId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "claimId" TEXT,
    "claimEvidenceRelationId" TEXT,
    "trustAssessmentId" TEXT,
    "criterion" TEXT,
    "subjectRefJson" TEXT NOT NULL,
    "canonicalSubjectHash" TEXT NOT NULL,
    "grounds" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "filedContentHash" TEXT NOT NULL,
    "challengerId" TEXT NOT NULL,
    "activeChallengerSubjectKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeTransition" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRoleSnapshot" TEXT NOT NULL,
    "rationale" TEXT,
    "filedContentHash" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustVerification" (
    "id" TEXT NOT NULL,
    "trustAssessmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewerRoleSnapshot" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "assessmentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeRelationTrustAssessment" (
    "id" TEXT NOT NULL,
    "nodeEdgeProposalId" TEXT NOT NULL,
    "protocolVersion" TEXT NOT NULL,
    "assessorType" TEXT NOT NULL,
    "assessorId" TEXT,
    "assessedAt" TIMESTAMP(3),
    "identityIntegrity" TEXT,
    "entailment" TEXT,
    "sourceAccess" TEXT,
    "populationRelevance" TEXT,
    "interventionExposureRelevance" TEXT,
    "outcomeRelevance" TEXT,
    "methodologicalSafeguards" TEXT,
    "statisticalSafeguards" TEXT,
    "replicationConvergence" TEXT,
    "conflictDependency" TEXT,
    "limitationsJson" TEXT NOT NULL DEFAULT '[]',
    "evidenceJson" TEXT,
    "aggregateScore" DOUBLE PRECISION,
    "aggregateMethod" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'unverified-import',
    "sourceRecordJson" TEXT NOT NULL,
    "sourceReviewStatus" TEXT NOT NULL,
    "sourceAssessorType" TEXT NOT NULL,
    "sourceAssessorId" TEXT,
    "sourceAssessedAt" TIMESTAMP(3),
    "sourceEvidenceJson" TEXT,
    "sourceAggregateScore" DOUBLE PRECISION,
    "sourceAggregateMethod" TEXT,
    "sourceRecordHash" TEXT,
    "sourceLineageKey" TEXT,
    "supersedesAssessmentId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeRelationTrustAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeRelationTrustVerification" (
    "id" TEXT NOT NULL,
    "nodeRelationTrustAssessmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewerRoleSnapshot" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "assessmentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeRelationTrustVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "modelProvider" TEXT,
    "modelName" TEXT,
    "modelVersion" TEXT,
    "promptVersion" TEXT,
    "promptHash" TEXT,
    "packetHash" TEXT,
    "inputHash" TEXT,
    "inputReferencesJson" TEXT,
    "outputJson" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "humanReviewStatus" TEXT NOT NULL DEFAULT 'unreviewed',

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SynthesisDraft" (
    "id" TEXT NOT NULL,
    "seriesKey" TEXT NOT NULL,
    "selectorJson" TEXT NOT NULL,
    "selectorHash" TEXT NOT NULL,
    "materializationPolicyVersion" TEXT NOT NULL,
    "generationKey" TEXT NOT NULL,
    "regenerationOrdinal" INTEGER NOT NULL,
    "parentDraftId" TEXT,
    "previousAcceptedDraftId" TEXT,
    "previousAcceptedOrdinal" INTEGER,
    "agentRunId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "packetJson" TEXT NOT NULL,
    "packetHash" TEXT NOT NULL,
    "documentJson" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "generationMode" TEXT NOT NULL,
    "pipelineSoftwareName" TEXT NOT NULL,
    "pipelineSoftwareId" TEXT NOT NULL,
    "pipelineSoftwareKind" TEXT NOT NULL,
    "pipelineSoftwareVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "acceptedByRoleSnapshot" TEXT,
    "acceptedByDisplayName" TEXT,
    "acceptedByGithubLogin" TEXT,
    "decisionRationale" TEXT,
    "checklistJson" TEXT,
    "checklistVersion" TEXT,
    "attributionPolicyVersion" TEXT NOT NULL,
    "rightsStatement" TEXT,
    "licenseSpdx" TEXT,
    "versionDoi" TEXT,
    "conceptDoi" TEXT,
    "reviewId" TEXT,
    "requestKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SynthesisDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SynthesisGenerationRequestClaim" (
    "key" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "selectorJson" TEXT NOT NULL,
    "selectorHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "draftId" TEXT,
    "agentRunId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SynthesisGenerationRequestClaim_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SynthesisDraftMembership" (
    "draftId" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeVersionId" TEXT NOT NULL,
    "identifierScheme" TEXT,
    "identifierRole" TEXT,
    "identifierValue" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "SynthesisDraftMembership_pkey" PRIMARY KEY ("draftId","referenceId")
);

-- CreateTable
CREATE TABLE "SynthesisDraftCitation" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "sectionId" TEXT,
    "paragraphIndex" INTEGER,
    "citationIndex" INTEGER NOT NULL,
    "referenceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeVersionId" TEXT NOT NULL,
    "nodeKind" TEXT NOT NULL,
    "nodeTitle" TEXT NOT NULL,
    "identifierScheme" TEXT,
    "identifierRole" TEXT,
    "identifierValue" TEXT,

    CONSTRAINT "SynthesisDraftCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SynthesisAttributionContributor" (
    "reviewVersionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "softwareVersion" TEXT,
    "userId" TEXT,
    "userRoleSnapshot" TEXT,
    "githubLoginSnapshot" TEXT,

    CONSTRAINT "SynthesisAttributionContributor_pkey" PRIMARY KEY ("reviewVersionId","position")
);

-- CreateTable
CREATE TABLE "SynthesisStalenessEvaluation" (
    "id" TEXT NOT NULL,
    "evaluationKey" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "acceptedReviewVersionId" TEXT NOT NULL,
    "acceptedDraftId" TEXT NOT NULL,
    "seriesKey" TEXT NOT NULL,
    "selectorJson" TEXT NOT NULL,
    "selectorHash" TEXT NOT NULL,
    "acceptedMaterializationPolicyVersion" TEXT NOT NULL,
    "evaluatedMaterializationPolicyVersion" TEXT NOT NULL,
    "acceptedPacketHash" TEXT NOT NULL,
    "acceptedPacketJson" TEXT NOT NULL,
    "evaluatedPacketHash" TEXT,
    "evaluatedPacketJson" TEXT,
    "failureCode" TEXT,
    "failureFingerprint" TEXT,
    "status" TEXT NOT NULL,
    "reasonCodesJson" TEXT NOT NULL,
    "affectedReferencesJson" TEXT NOT NULL,
    "affectedReferenceCount" INTEGER NOT NULL,
    "affectedReferencesTruncated" BOOLEAN NOT NULL DEFAULT false,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SynthesisStalenessEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SynthesisStalenessHead" (
    "acceptedReviewVersionId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "currentEvaluationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SynthesisStalenessHead_pkey" PRIMARY KEY ("acceptedReviewVersionId")
);

-- CreateTable
CREATE TABLE "SynthesisRegenerationProposal" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "acceptedReviewVersionId" TEXT NOT NULL,
    "openHeadKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionRationale" TEXT,
    "resolutionIdempotencyKey" TEXT,
    "resolutionInputHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SynthesisRegenerationProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "scopeJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscussionThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "groundingJson" TEXT,
    "modelMetadataJson" TEXT,
    "agentRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewComment" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reviewVersionId" TEXT,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "claimId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'comment',
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'visible',
    "removedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeLinkProposal" (
    "id" TEXT NOT NULL,
    "sourceClaimId" TEXT NOT NULL,
    "targetClaimId" TEXT NOT NULL,
    "proposedRelation" TEXT NOT NULL,
    "featuresJson" TEXT NOT NULL,
    "semanticSimilarity" DOUBLE PRECISION,
    "rationale" TEXT NOT NULL,
    "agentProvenance" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeLinkProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT,
    "platformVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "requestHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EditorAssignment" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "editorId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "coiDeclared" BOOLEAN NOT NULL DEFAULT false,
    "coiStatement" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRound" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormalReviewReport" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewerOrcid" TEXT,
    "reviewerOrcidVerified" BOOLEAN NOT NULL DEFAULT false,
    "recommendation" TEXT NOT NULL,
    "bodyJson" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "coiStatement" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormalReviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorResponse" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "bodyJson" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionLetter" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "editorId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "bodyJson" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitationStatusRecord" (
    "id" TEXT NOT NULL,
    "workAlias" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "note" TEXT,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CitationStatusRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimUpdateProposal" (
    "id" TEXT NOT NULL,
    "statusRecordId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "citationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "rationale" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ClaimUpdateProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederationNotification" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "actorUri" TEXT,
    "objectUri" TEXT NOT NULL,
    "contextUri" TEXT,
    "originUri" TEXT NOT NULL,
    "originInbox" TEXT,
    "targetUri" TEXT NOT NULL,
    "targetInbox" TEXT NOT NULL,
    "inReplyTo" TEXT,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "reviewVersionId" TEXT,
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "FederationNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolSnapshot" (
    "id" TEXT NOT NULL,
    "reviewVersionId" TEXT NOT NULL,
    "claimId" TEXT,
    "createdById" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "registry" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "sourceTimestamp" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "normalizedJson" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "questionMetadataJson" TEXT,
    "contentHash" TEXT NOT NULL,
    "observedJson" TEXT NOT NULL,
    "comparatorVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtocolSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolDriftProposal" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "registeredJson" TEXT NOT NULL,
    "observedJson" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "comparatorVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtocolDriftProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_githubUserId_key" ON "User"("githubUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubLogin_key" ON "User"("githubLogin");

-- CreateIndex
CREATE INDEX "User_githubLoginNormalized_idx" ON "User"("githubLoginNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_canonicalUrl_key" ON "Repository"("canonicalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubRepositoryId_key" ON "Repository"("githubRepositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_host_owner_name_key" ON "Repository"("host", "owner", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RepositorySnapshot_repositoryId_commitSha_key" ON "RepositorySnapshot"("repositoryId", "commitSha");

-- CreateIndex
CREATE UNIQUE INDEX "Review_slug_key" ON "Review"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Review_repositoryId_key" ON "Review"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_synthesisSeriesKey_key" ON "Review"("synthesisSeriesKey");

-- CreateIndex
CREATE UNIQUE INDEX "Review_currentSynthesisVersionId_key" ON "Review"("currentSynthesisVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewVersion_synthesisDraftId_key" ON "ReviewVersion"("synthesisDraftId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewVersion_sourceSubmissionId_key" ON "ReviewVersion"("sourceSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewVersion_inspectionCaptureId_key" ON "ReviewVersion"("inspectionCaptureId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewVersion_reviewId_snapshotId_sourceSelectionKey_key" ON "ReviewVersion"("reviewId", "snapshotId", "sourceSelectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewVersion_reviewId_synthesisOrdinal_key" ON "ReviewVersion"("reviewId", "synthesisOrdinal");

-- CreateIndex
CREATE INDEX "ReviewLifecycleEvent_reviewVersionId_createdAt_idx" ON "ReviewLifecycleEvent"("reviewVersionId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewLifecycleEvent_kind_createdAt_idx" ON "ReviewLifecycleEvent"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewLifecycleEvent_reviewId_revision_key" ON "ReviewLifecycleEvent"("reviewId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionCapture_tokenHash_key" ON "InspectionCapture"("tokenHash");

-- CreateIndex
CREATE INDEX "InspectionCapture_expiresAt_idx" ON "InspectionCapture"("expiresAt");

-- CreateIndex
CREATE INDEX "InspectionCapture_payloadHash_idx" ON "InspectionCapture"("payloadHash");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_inspectionCaptureId_key" ON "Submission"("inspectionCaptureId");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_previousSubmissionId_key" ON "Submission"("previousSubmissionId");

-- CreateIndex
CREATE INDEX "EditorialOverride_editorId_idx" ON "EditorialOverride"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialOverride_submissionId_checkId_key" ON "EditorialOverride"("submissionId", "checkId");

-- CreateIndex
CREATE INDEX "Identifier_scheme_normalizedValue_idx" ON "Identifier"("scheme", "normalizedValue");

-- CreateIndex
CREATE INDEX "Claim_knowledgeNodeId_idx" ON "Claim"("knowledgeNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_reviewVersionId_localClaimId_key" ON "Claim"("reviewVersionId", "localClaimId");

-- CreateIndex
CREATE INDEX "KnowledgeNode_kind_idx" ON "KnowledgeNode"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeNode_repositoryId_localNodeId_key" ON "KnowledgeNode"("repositoryId", "localNodeId");

-- CreateIndex
CREATE INDEX "KnowledgeNodeVersion_snapshotId_idx" ON "KnowledgeNodeVersion"("snapshotId");

-- CreateIndex
CREATE INDEX "KnowledgeNodeVersion_sourceSubmissionId_idx" ON "KnowledgeNodeVersion"("sourceSubmissionId");

-- CreateIndex
CREATE INDEX "KnowledgeNodeVersion_inspectionCaptureId_idx" ON "KnowledgeNodeVersion"("inspectionCaptureId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeNodeVersion_knowledgeNodeId_snapshotId_key" ON "KnowledgeNodeVersion"("knowledgeNodeId", "snapshotId");

-- CreateIndex
CREATE INDEX "NodeEdge_targetNodeId_idx" ON "NodeEdge"("targetNodeId");

-- CreateIndex
CREATE INDEX "NodeEdge_status_relationType_idx" ON "NodeEdge"("status", "relationType");

-- CreateIndex
CREATE INDEX "NodeEdge_confirmedTargetNodeVersionId_idx" ON "NodeEdge"("confirmedTargetNodeVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "NodeEdge_sourceNodeVersionId_targetNodeId_relationType_key" ON "NodeEdge"("sourceNodeVersionId", "targetNodeId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "NodeEdgeProposal_originKey_key" ON "NodeEdgeProposal"("originKey");

-- CreateIndex
CREATE INDEX "NodeEdgeProposal_status_createdAt_idx" ON "NodeEdgeProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NodeEdgeProposal_sourceNodeVersionId_idx" ON "NodeEdgeProposal"("sourceNodeVersionId");

-- CreateIndex
CREATE INDEX "NodeEdgeProposal_targetNodeId_idx" ON "NodeEdgeProposal"("targetNodeId");

-- CreateIndex
CREATE INDEX "NodeEdgeProposal_confirmedEdgeId_idx" ON "NodeEdgeProposal"("confirmedEdgeId");

-- CreateIndex
CREATE INDEX "NodeAlias_scheme_value_idx" ON "NodeAlias"("scheme", "value");

-- CreateIndex
CREATE UNIQUE INDEX "NodeAlias_knowledgeNodeId_scheme_role_value_key" ON "NodeAlias"("knowledgeNodeId", "scheme", "role", "value");

-- CreateIndex
CREATE INDEX "NodeIdentityProposal_status_createdAt_idx" ON "NodeIdentityProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NodeIdentityProposal_sourceNodeId_status_idx" ON "NodeIdentityProposal"("sourceNodeId", "status");

-- CreateIndex
CREATE INDEX "NodeIdentityProposal_targetNodeId_status_idx" ON "NodeIdentityProposal"("targetNodeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReplicationBrief_requestKey_key" ON "ReplicationBrief"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReplicationBrief_slug_key" ON "ReplicationBrief"("slug");

-- CreateIndex
CREATE INDEX "ReplicationBrief_status_publishedAt_idx" ON "ReplicationBrief"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "ReplicationBrief_effortBand_status_idx" ON "ReplicationBrief"("effortBand", "status");

-- CreateIndex
CREATE INDEX "ReplicationBrief_claimedById_status_idx" ON "ReplicationBrief"("claimedById", "status");

-- CreateIndex
CREATE INDEX "ReplicationBriefClaim_claimId_idx" ON "ReplicationBriefClaim"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplicationBriefClaim_replicationBriefId_position_key" ON "ReplicationBriefClaim"("replicationBriefId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionPassport_payloadSha256_key" ON "ExecutionPassport"("payloadSha256");

-- CreateIndex
CREATE INDEX "ExecutionPassport_verificationStatus_registeredAt_idx" ON "ExecutionPassport"("verificationStatus", "registeredAt");

-- CreateIndex
CREATE INDEX "ExecutionPassport_commitSha_idx" ON "ExecutionPassport"("commitSha");

-- CreateIndex
CREATE INDEX "ExecutionPassportClaim_claimId_idx" ON "ExecutionPassportClaim"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionPassportClaim_passportId_claimId_key" ON "ExecutionPassportClaim"("passportId", "claimId");

-- CreateIndex
CREATE INDEX "ExecutionPassportArtifact_passportId_role_idx" ON "ExecutionPassportArtifact"("passportId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionPassportArtifact_passportId_entityId_key" ON "ExecutionPassportArtifact"("passportId", "entityId");

-- CreateIndex
CREATE INDEX "Citation_doi_idx" ON "Citation"("doi");

-- CreateIndex
CREATE UNIQUE INDEX "Citation_reviewVersionId_localCitationId_key" ON "Citation"("reviewVersionId", "localCitationId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimEvidenceRelation_claimId_citationId_relationType_key" ON "ClaimEvidenceRelation"("claimId", "citationId", "relationType");

-- CreateIndex
CREATE INDEX "TrustAssessment_reviewStatus_idx" ON "TrustAssessment"("reviewStatus");

-- CreateIndex
CREATE INDEX "TrustAssessment_claimEvidenceRelationId_sourceLineageKey_idx" ON "TrustAssessment"("claimEvidenceRelationId", "sourceLineageKey");

-- CreateIndex
CREATE UNIQUE INDEX "TrustAssessment_claimEvidenceRelationId_sourceRecordHash_key" ON "TrustAssessment"("claimEvidenceRelationId", "sourceRecordHash");

-- CreateIndex
CREATE UNIQUE INDEX "Challenge_activeChallengerSubjectKey_key" ON "Challenge"("activeChallengerSubjectKey");

-- CreateIndex
CREATE INDEX "Challenge_reviewVersionId_createdAt_idx" ON "Challenge"("reviewVersionId", "createdAt");

-- CreateIndex
CREATE INDEX "Challenge_canonicalSubjectHash_status_idx" ON "Challenge"("canonicalSubjectHash", "status");

-- CreateIndex
CREATE INDEX "Challenge_challengerId_createdAt_idx" ON "Challenge"("challengerId", "createdAt");

-- CreateIndex
CREATE INDEX "ChallengeTransition_challengeId_createdAt_idx" ON "ChallengeTransition"("challengeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeTransition_challengeId_revision_key" ON "ChallengeTransition"("challengeId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "TrustVerification_trustAssessmentId_key" ON "TrustVerification"("trustAssessmentId");

-- CreateIndex
CREATE INDEX "TrustVerification_status_idx" ON "TrustVerification"("status");

-- CreateIndex
CREATE INDEX "TrustVerification_reviewerId_idx" ON "TrustVerification"("reviewerId");

-- CreateIndex
CREATE INDEX "NodeRelationTrustAssessment_nodeEdgeProposalId_idx" ON "NodeRelationTrustAssessment"("nodeEdgeProposalId");

-- CreateIndex
CREATE INDEX "NodeRelationTrustAssessment_reviewStatus_idx" ON "NodeRelationTrustAssessment"("reviewStatus");

-- CreateIndex
CREATE INDEX "NodeRelationTrustAssessment_nodeEdgeProposalId_sourceLineag_idx" ON "NodeRelationTrustAssessment"("nodeEdgeProposalId", "sourceLineageKey");

-- CreateIndex
CREATE UNIQUE INDEX "NodeRelationTrustAssessment_nodeEdgeProposalId_sourceRecord_key" ON "NodeRelationTrustAssessment"("nodeEdgeProposalId", "sourceRecordHash");

-- CreateIndex
CREATE UNIQUE INDEX "NodeRelationTrustVerification_nodeRelationTrustAssessmentId_key" ON "NodeRelationTrustVerification"("nodeRelationTrustAssessmentId");

-- CreateIndex
CREATE INDEX "NodeRelationTrustVerification_status_idx" ON "NodeRelationTrustVerification"("status");

-- CreateIndex
CREATE INDEX "NodeRelationTrustVerification_reviewerId_idx" ON "NodeRelationTrustVerification"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "SynthesisDraft_agentRunId_key" ON "SynthesisDraft"("agentRunId");

-- CreateIndex
CREATE UNIQUE INDEX "SynthesisDraft_requestKey_key" ON "SynthesisDraft"("requestKey");

-- CreateIndex
CREATE INDEX "SynthesisDraft_status_createdAt_idx" ON "SynthesisDraft"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SynthesisDraft_seriesKey_status_idx" ON "SynthesisDraft"("seriesKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SynthesisDraft_seriesKey_regenerationOrdinal_key" ON "SynthesisDraft"("seriesKey", "regenerationOrdinal");

-- CreateIndex
CREATE UNIQUE INDEX "SynthesisDraft_generationKey_regenerationOrdinal_key" ON "SynthesisDraft"("generationKey", "regenerationOrdinal");

-- CreateIndex
CREATE UNIQUE INDEX "SynthesisGenerationRequestClaim_requestKey_key" ON "SynthesisGenerationRequestClaim"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "SynthesisGenerationRequestClaim_draftId_key" ON "SynthesisGenerationRequestClaim"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "SynthesisGenerationRequestClaim_agentRunId_key" ON "SynthesisGenerationRequestClaim"("agentRunId");

-- CreateIndex
CREATE INDEX "SynthesisGenerationRequestClaim_status_updatedAt_idx" ON "SynthesisGenerationRequestClaim"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "SynthesisDraftMembership_nodeId_nodeVersionId_idx" ON "SynthesisDraftMembership"("nodeId", "nodeVersionId");

-- CreateIndex
CREATE INDEX "SynthesisDraftMembership_referenceId_idx" ON "SynthesisDraftMembership"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "SynthesisDraftMembership_draftId_position_key" ON "SynthesisDraftMembership"("draftId", "position");

-- CreateIndex
CREATE INDEX "SynthesisDraftCitation_draftId_referenceId_idx" ON "SynthesisDraftCitation"("draftId", "referenceId");

-- CreateIndex
CREATE INDEX "SynthesisDraftCitation_nodeId_nodeVersionId_idx" ON "SynthesisDraftCitation"("nodeId", "nodeVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "SynthesisDraftCitation_draftId_occurrenceKey_key" ON "SynthesisDraftCitation"("draftId", "occurrenceKey");

-- CreateIndex
CREATE INDEX "SynthesisAttributionContributor_userId_idx" ON "SynthesisAttributionContributor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SynthesisStalenessEvaluation_evaluationKey_key" ON "SynthesisStalenessEvaluation"("evaluationKey");

-- CreateIndex
CREATE INDEX "SynthesisStalenessEvaluation_acceptedReviewVersionId_evalua_idx" ON "SynthesisStalenessEvaluation"("acceptedReviewVersionId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "SynthesisStalenessEvaluation_reviewId_evaluatedAt_idx" ON "SynthesisStalenessEvaluation"("reviewId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "SynthesisStalenessHead_reviewId_idx" ON "SynthesisStalenessHead"("reviewId");

-- CreateIndex
CREATE INDEX "SynthesisStalenessHead_currentEvaluationId_idx" ON "SynthesisStalenessHead"("currentEvaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "SynthesisRegenerationProposal_openHeadKey_key" ON "SynthesisRegenerationProposal"("openHeadKey");

-- CreateIndex
CREATE INDEX "SynthesisRegenerationProposal_status_createdAt_idx" ON "SynthesisRegenerationProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SynthesisRegenerationProposal_reviewId_status_idx" ON "SynthesisRegenerationProposal"("reviewId", "status");

-- CreateIndex
CREATE INDEX "SynthesisRegenerationProposal_evaluationId_idx" ON "SynthesisRegenerationProposal"("evaluationId");

-- CreateIndex
CREATE INDEX "ReviewComment_reviewId_createdAt_idx" ON "ReviewComment"("reviewId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewComment_reviewVersionId_createdAt_idx" ON "ReviewComment"("reviewVersionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLinkProposal_sourceClaimId_targetClaimId_proposedR_key" ON "KnowledgeLinkProposal"("sourceClaimId", "targetClaimId", "proposedRelation");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectType_subjectId_idx" ON "AuditEvent"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AuditEvent_idempotencyKey_idx" ON "AuditEvent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "EditorAssignment_submissionId_editorId_key" ON "EditorAssignment"("submissionId", "editorId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRound_submissionId_roundNumber_key" ON "ReviewRound"("submissionId", "roundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FormalReviewReport_roundId_reviewerId_key" ON "FormalReviewReport"("roundId", "reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionLetter_roundId_key" ON "DecisionLetter"("roundId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "CitationStatusRecord_workAlias_idx" ON "CitationStatusRecord"("workAlias");

-- CreateIndex
CREATE INDEX "ClaimUpdateProposal_status_idx" ON "ClaimUpdateProposal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimUpdateProposal_statusRecordId_claimId_key" ON "ClaimUpdateProposal"("statusRecordId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "FederationNotification_activityId_key" ON "FederationNotification"("activityId");

-- CreateIndex
CREATE INDEX "FederationNotification_direction_status_createdAt_idx" ON "FederationNotification"("direction", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FederationNotification_reviewVersionId_idx" ON "FederationNotification"("reviewVersionId");

-- CreateIndex
CREATE INDEX "FederationNotification_inReplyTo_idx" ON "FederationNotification"("inReplyTo");

-- CreateIndex
CREATE INDEX "ProtocolSnapshot_reviewVersionId_createdAt_idx" ON "ProtocolSnapshot"("reviewVersionId", "createdAt");

-- CreateIndex
CREATE INDEX "ProtocolSnapshot_claimId_createdAt_idx" ON "ProtocolSnapshot"("claimId", "createdAt");

-- CreateIndex
CREATE INDEX "ProtocolSnapshot_registry_sourceId_idx" ON "ProtocolSnapshot"("registry", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProtocolSnapshot_targetKey_registry_sourceId_sourceVersion_key" ON "ProtocolSnapshot"("targetKey", "registry", "sourceId", "sourceVersion");

-- CreateIndex
CREATE INDEX "ProtocolDriftProposal_snapshotId_status_idx" ON "ProtocolDriftProposal"("snapshotId", "status");

-- CreateIndex
CREATE INDEX "ProtocolDriftProposal_status_createdAt_idx" ON "ProtocolDriftProposal"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "RepositorySnapshot" ADD CONSTRAINT "RepositorySnapshot_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_currentSnapshotId_fkey" FOREIGN KEY ("currentSnapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_currentSynthesisVersionId_fkey" FOREIGN KEY ("currentSynthesisVersionId") REFERENCES "ReviewVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVersion" ADD CONSTRAINT "ReviewVersion_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVersion" ADD CONSTRAINT "ReviewVersion_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVersion" ADD CONSTRAINT "ReviewVersion_synthesisDraftId_fkey" FOREIGN KEY ("synthesisDraftId") REFERENCES "SynthesisDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVersion" ADD CONSTRAINT "ReviewVersion_synthesisApprovedById_fkey" FOREIGN KEY ("synthesisApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVersion" ADD CONSTRAINT "ReviewVersion_acceptedPredecessorVersionId_fkey" FOREIGN KEY ("acceptedPredecessorVersionId") REFERENCES "ReviewVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVersion" ADD CONSTRAINT "ReviewVersion_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVersion" ADD CONSTRAINT "ReviewVersion_inspectionCaptureId_fkey" FOREIGN KEY ("inspectionCaptureId") REFERENCES "InspectionCapture"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLifecycleEvent" ADD CONSTRAINT "ReviewLifecycleEvent_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLifecycleEvent" ADD CONSTRAINT "ReviewLifecycleEvent_reviewVersionId_fkey" FOREIGN KEY ("reviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLifecycleEvent" ADD CONSTRAINT "ReviewLifecycleEvent_supersedesVersionId_fkey" FOREIGN KEY ("supersedesVersionId") REFERENCES "ReviewVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLifecycleEvent" ADD CONSTRAINT "ReviewLifecycleEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionCapture" ADD CONSTRAINT "InspectionCapture_inspectedByUserId_fkey" FOREIGN KEY ("inspectedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewContributor" ADD CONSTRAINT "ReviewContributor_reviewVersionId_fkey" FOREIGN KEY ("reviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewContributor" ADD CONSTRAINT "ReviewContributor_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_inspectionCaptureId_fkey" FOREIGN KEY ("inspectionCaptureId") REFERENCES "InspectionCapture"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_resultingReviewVersionId_fkey" FOREIGN KEY ("resultingReviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_previousSubmissionId_fkey" FOREIGN KEY ("previousSubmissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialOverride" ADD CONSTRAINT "EditorialOverride_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialOverride" ADD CONSTRAINT "EditorialOverride_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Identifier" ADD CONSTRAINT "Identifier_reviewVersionId_fkey" FOREIGN KEY ("reviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_reviewVersionId_fkey" FOREIGN KEY ("reviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeNode" ADD CONSTRAINT "KnowledgeNode_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeNodeVersion" ADD CONSTRAINT "KnowledgeNodeVersion_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeNodeVersion" ADD CONSTRAINT "KnowledgeNodeVersion_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeNodeVersion" ADD CONSTRAINT "KnowledgeNodeVersion_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeNodeVersion" ADD CONSTRAINT "KnowledgeNodeVersion_inspectionCaptureId_fkey" FOREIGN KEY ("inspectionCaptureId") REFERENCES "InspectionCapture"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeEdge" ADD CONSTRAINT "NodeEdge_sourceNodeVersionId_fkey" FOREIGN KEY ("sourceNodeVersionId") REFERENCES "KnowledgeNodeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeEdge" ADD CONSTRAINT "NodeEdge_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeEdge" ADD CONSTRAINT "NodeEdge_confirmedTargetNodeVersionId_fkey" FOREIGN KEY ("confirmedTargetNodeVersionId") REFERENCES "KnowledgeNodeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeEdge" ADD CONSTRAINT "NodeEdge_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeEdgeProposal" ADD CONSTRAINT "NodeEdgeProposal_sourceNodeVersionId_fkey" FOREIGN KEY ("sourceNodeVersionId") REFERENCES "KnowledgeNodeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeEdgeProposal" ADD CONSTRAINT "NodeEdgeProposal_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeEdgeProposal" ADD CONSTRAINT "NodeEdgeProposal_targetNodeVersionId_fkey" FOREIGN KEY ("targetNodeVersionId") REFERENCES "KnowledgeNodeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeEdgeProposal" ADD CONSTRAINT "NodeEdgeProposal_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeEdgeProposal" ADD CONSTRAINT "NodeEdgeProposal_inspectionCaptureId_fkey" FOREIGN KEY ("inspectionCaptureId") REFERENCES "InspectionCapture"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeEdgeProposal" ADD CONSTRAINT "NodeEdgeProposal_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeEdgeProposal" ADD CONSTRAINT "NodeEdgeProposal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeEdgeProposal" ADD CONSTRAINT "NodeEdgeProposal_confirmedEdgeId_fkey" FOREIGN KEY ("confirmedEdgeId") REFERENCES "NodeEdge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeAlias" ADD CONSTRAINT "NodeAlias_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeIdentityProposal" ADD CONSTRAINT "NodeIdentityProposal_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeIdentityProposal" ADD CONSTRAINT "NodeIdentityProposal_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeIdentityProposal" ADD CONSTRAINT "NodeIdentityProposal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplicationBrief" ADD CONSTRAINT "ReplicationBrief_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplicationBrief" ADD CONSTRAINT "ReplicationBrief_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplicationBrief" ADD CONSTRAINT "ReplicationBrief_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplicationBrief" ADD CONSTRAINT "ReplicationBrief_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplicationBrief" ADD CONSTRAINT "ReplicationBrief_withdrawnById_fkey" FOREIGN KEY ("withdrawnById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplicationBriefClaim" ADD CONSTRAINT "ReplicationBriefClaim_replicationBriefId_fkey" FOREIGN KEY ("replicationBriefId") REFERENCES "ReplicationBrief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplicationBriefClaim" ADD CONSTRAINT "ReplicationBriefClaim_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionPassport" ADD CONSTRAINT "ExecutionPassport_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionPassport" ADD CONSTRAINT "ExecutionPassport_lastVerifiedById_fkey" FOREIGN KEY ("lastVerifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionPassportClaim" ADD CONSTRAINT "ExecutionPassportClaim_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "ExecutionPassport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionPassportClaim" ADD CONSTRAINT "ExecutionPassportClaim_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionPassportArtifact" ADD CONSTRAINT "ExecutionPassportArtifact_passportId_fkey" FOREIGN KEY ("passportId") REFERENCES "ExecutionPassport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_reviewVersionId_fkey" FOREIGN KEY ("reviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidenceRelation" ADD CONSTRAINT "ClaimEvidenceRelation_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidenceRelation" ADD CONSTRAINT "ClaimEvidenceRelation_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "Citation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustAssessment" ADD CONSTRAINT "TrustAssessment_claimEvidenceRelationId_fkey" FOREIGN KEY ("claimEvidenceRelationId") REFERENCES "ClaimEvidenceRelation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustAssessment" ADD CONSTRAINT "TrustAssessment_supersedesAssessmentId_fkey" FOREIGN KEY ("supersedesAssessmentId") REFERENCES "TrustAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_reviewVersionId_fkey" FOREIGN KEY ("reviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_claimEvidenceRelationId_fkey" FOREIGN KEY ("claimEvidenceRelationId") REFERENCES "ClaimEvidenceRelation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_trustAssessmentId_fkey" FOREIGN KEY ("trustAssessmentId") REFERENCES "TrustAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_challengerId_fkey" FOREIGN KEY ("challengerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeTransition" ADD CONSTRAINT "ChallengeTransition_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeTransition" ADD CONSTRAINT "ChallengeTransition_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustVerification" ADD CONSTRAINT "TrustVerification_trustAssessmentId_fkey" FOREIGN KEY ("trustAssessmentId") REFERENCES "TrustAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustVerification" ADD CONSTRAINT "TrustVerification_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeRelationTrustAssessment" ADD CONSTRAINT "NodeRelationTrustAssessment_nodeEdgeProposalId_fkey" FOREIGN KEY ("nodeEdgeProposalId") REFERENCES "NodeEdgeProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeRelationTrustAssessment" ADD CONSTRAINT "NodeRelationTrustAssessment_supersedesAssessmentId_fkey" FOREIGN KEY ("supersedesAssessmentId") REFERENCES "NodeRelationTrustAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeRelationTrustVerification" ADD CONSTRAINT "NodeRelationTrustVerification_nodeRelationTrustAssessmentI_fkey" FOREIGN KEY ("nodeRelationTrustAssessmentId") REFERENCES "NodeRelationTrustAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeRelationTrustVerification" ADD CONSTRAINT "NodeRelationTrustVerification_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisDraft" ADD CONSTRAINT "SynthesisDraft_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisDraft" ADD CONSTRAINT "SynthesisDraft_parentDraftId_fkey" FOREIGN KEY ("parentDraftId") REFERENCES "SynthesisDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisDraft" ADD CONSTRAINT "SynthesisDraft_previousAcceptedDraftId_fkey" FOREIGN KEY ("previousAcceptedDraftId") REFERENCES "SynthesisDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisDraft" ADD CONSTRAINT "SynthesisDraft_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisDraft" ADD CONSTRAINT "SynthesisDraft_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisGenerationRequestClaim" ADD CONSTRAINT "SynthesisGenerationRequestClaim_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SynthesisDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisGenerationRequestClaim" ADD CONSTRAINT "SynthesisGenerationRequestClaim_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisDraftMembership" ADD CONSTRAINT "SynthesisDraftMembership_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SynthesisDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisDraftMembership" ADD CONSTRAINT "SynthesisDraftMembership_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisDraftMembership" ADD CONSTRAINT "SynthesisDraftMembership_nodeVersionId_fkey" FOREIGN KEY ("nodeVersionId") REFERENCES "KnowledgeNodeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisDraftCitation" ADD CONSTRAINT "SynthesisDraftCitation_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SynthesisDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisDraftCitation" ADD CONSTRAINT "SynthesisDraftCitation_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisDraftCitation" ADD CONSTRAINT "SynthesisDraftCitation_nodeVersionId_fkey" FOREIGN KEY ("nodeVersionId") REFERENCES "KnowledgeNodeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisAttributionContributor" ADD CONSTRAINT "SynthesisAttributionContributor_reviewVersionId_fkey" FOREIGN KEY ("reviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisAttributionContributor" ADD CONSTRAINT "SynthesisAttributionContributor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisStalenessEvaluation" ADD CONSTRAINT "SynthesisStalenessEvaluation_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisStalenessEvaluation" ADD CONSTRAINT "SynthesisStalenessEvaluation_acceptedReviewVersionId_fkey" FOREIGN KEY ("acceptedReviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisStalenessEvaluation" ADD CONSTRAINT "SynthesisStalenessEvaluation_acceptedDraftId_fkey" FOREIGN KEY ("acceptedDraftId") REFERENCES "SynthesisDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisStalenessHead" ADD CONSTRAINT "SynthesisStalenessHead_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisStalenessHead" ADD CONSTRAINT "SynthesisStalenessHead_acceptedReviewVersionId_fkey" FOREIGN KEY ("acceptedReviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisStalenessHead" ADD CONSTRAINT "SynthesisStalenessHead_currentEvaluationId_fkey" FOREIGN KEY ("currentEvaluationId") REFERENCES "SynthesisStalenessEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisRegenerationProposal" ADD CONSTRAINT "SynthesisRegenerationProposal_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "SynthesisStalenessEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisRegenerationProposal" ADD CONSTRAINT "SynthesisRegenerationProposal_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisRegenerationProposal" ADD CONSTRAINT "SynthesisRegenerationProposal_acceptedReviewVersionId_fkey" FOREIGN KEY ("acceptedReviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SynthesisRegenerationProposal" ADD CONSTRAINT "SynthesisRegenerationProposal_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionThread" ADD CONSTRAINT "DiscussionThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionMessage" ADD CONSTRAINT "DiscussionMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DiscussionThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionMessage" ADD CONSTRAINT "DiscussionMessage_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_reviewVersionId_fkey" FOREIGN KEY ("reviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ReviewComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLinkProposal" ADD CONSTRAINT "KnowledgeLinkProposal_sourceClaimId_fkey" FOREIGN KEY ("sourceClaimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLinkProposal" ADD CONSTRAINT "KnowledgeLinkProposal_targetClaimId_fkey" FOREIGN KEY ("targetClaimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorAssignment" ADD CONSTRAINT "EditorAssignment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorAssignment" ADD CONSTRAINT "EditorAssignment_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorAssignment" ADD CONSTRAINT "EditorAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormalReviewReport" ADD CONSTRAINT "FormalReviewReport_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ReviewRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormalReviewReport" ADD CONSTRAINT "FormalReviewReport_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorResponse" ADD CONSTRAINT "AuthorResponse_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ReviewRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorResponse" ADD CONSTRAINT "AuthorResponse_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionLetter" ADD CONSTRAINT "DecisionLetter_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ReviewRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionLetter" ADD CONSTRAINT "DecisionLetter_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationStatusRecord" ADD CONSTRAINT "CitationStatusRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimUpdateProposal" ADD CONSTRAINT "ClaimUpdateProposal_statusRecordId_fkey" FOREIGN KEY ("statusRecordId") REFERENCES "CitationStatusRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimUpdateProposal" ADD CONSTRAINT "ClaimUpdateProposal_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimUpdateProposal" ADD CONSTRAINT "ClaimUpdateProposal_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "Citation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimUpdateProposal" ADD CONSTRAINT "ClaimUpdateProposal_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationNotification" ADD CONSTRAINT "FederationNotification_reviewVersionId_fkey" FOREIGN KEY ("reviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationNotification" ADD CONSTRAINT "FederationNotification_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolSnapshot" ADD CONSTRAINT "ProtocolSnapshot_reviewVersionId_fkey" FOREIGN KEY ("reviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolSnapshot" ADD CONSTRAINT "ProtocolSnapshot_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolSnapshot" ADD CONSTRAINT "ProtocolSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolDriftProposal" ADD CONSTRAINT "ProtocolDriftProposal_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProtocolSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolDriftProposal" ADD CONSTRAINT "ProtocolDriftProposal_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Database-native guards also applied after Prisma db push.
ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_source_union_check";

ALTER TABLE "Review" ADD CONSTRAINT "Review_source_union_check" CHECK (
    ("reviewType" = 'ai-synthesis' AND "repositoryId" IS NULL AND "currentSnapshotId" IS NULL AND "synthesisSeriesKey" IS NOT NULL)
    OR (("reviewType" IS NULL OR "reviewType" <> 'ai-synthesis') AND "synthesisSeriesKey" IS NULL AND "currentSynthesisVersionId" IS NULL)
  );

ALTER TABLE "ReviewVersion" DROP CONSTRAINT IF EXISTS "ReviewVersion_source_union_check";

ALTER TABLE "ReviewVersion" ADD CONSTRAINT "ReviewVersion_source_union_check" CHECK (
    ("recordSourceType" = 'repository' AND "snapshotId" IS NOT NULL AND "synthesisDraftId" IS NULL AND "synthesisDocumentJson" IS NULL AND "synthesisOrdinal" IS NULL)
    OR ("recordSourceType" = 'synthesis' AND "snapshotId" IS NULL AND "synthesisDraftId" IS NOT NULL AND "synthesisDocumentJson" IS NOT NULL AND "synthesisOrdinal" IS NOT NULL)
  );

ALTER TABLE "SynthesisDraft" DROP CONSTRAINT IF EXISTS "SynthesisDraft_status_check";

ALTER TABLE "SynthesisDraft" ADD CONSTRAINT "SynthesisDraft_status_check" CHECK (
    "status" IN ('pending', 'accepted', 'rejected', 'regeneration-requested')
  );

ALTER TABLE "SynthesisGenerationRequestClaim" DROP CONSTRAINT IF EXISTS "SynthesisGenerationRequestClaim_status_check";

ALTER TABLE "SynthesisGenerationRequestClaim" ADD CONSTRAINT "SynthesisGenerationRequestClaim_status_check" CHECK (
    ("status" = 'running' AND "draftId" IS NULL AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR ("status" = 'completed' AND "draftId" IS NOT NULL AND "agentRunId" IS NOT NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)
    OR ("status" = 'failed' AND "draftId" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL AND "errorCode" IS NOT NULL)
  );

ALTER TABLE "SynthesisDraftMembership" DROP CONSTRAINT IF EXISTS "SynthesisDraftMembership_identifier_shape_check";

ALTER TABLE "SynthesisDraftMembership" ADD CONSTRAINT "SynthesisDraftMembership_identifier_shape_check" CHECK (
    ("kind" = 'node' AND "identifierScheme" IS NULL AND "identifierRole" IS NULL AND "identifierValue" IS NULL)
    OR ("kind" = 'identifier' AND "identifierScheme" IS NOT NULL AND "identifierRole" IS NOT NULL AND "identifierValue" IS NOT NULL)
  );

ALTER TABLE "SynthesisStalenessEvaluation" DROP CONSTRAINT IF EXISTS "SynthesisStalenessEvaluation_status_check";

ALTER TABLE "SynthesisStalenessEvaluation" ADD CONSTRAINT "SynthesisStalenessEvaluation_status_check" CHECK (
    "status" IN ('fresh', 'stale') AND "affectedReferenceCount" >= 0
    AND (("evaluatedPacketHash" IS NULL AND "evaluatedPacketJson" IS NULL) OR ("evaluatedPacketHash" IS NOT NULL AND "evaluatedPacketJson" IS NOT NULL))
    AND (("failureCode" IS NULL AND "failureFingerprint" IS NULL AND "evaluatedPacketJson" IS NOT NULL)
      OR ("failureCode" IS NOT NULL AND "failureFingerprint" IS NOT NULL AND "evaluatedPacketJson" IS NULL))
  );

ALTER TABLE "SynthesisRegenerationProposal" DROP CONSTRAINT IF EXISTS "SynthesisRegenerationProposal_status_check";

ALTER TABLE "SynthesisRegenerationProposal" ADD CONSTRAINT "SynthesisRegenerationProposal_status_check" CHECK (
    ("status" = 'open' AND "openHeadKey" = "acceptedReviewVersionId" AND "resolvedById" IS NULL AND "resolvedAt" IS NULL AND "resolutionRationale" IS NULL AND "resolutionIdempotencyKey" IS NULL AND "resolutionInputHash" IS NULL)
    OR ("status" = 'superseded' AND "openHeadKey" IS NULL AND "resolvedById" IS NULL AND "resolvedAt" IS NULL AND "resolutionRationale" IS NULL AND "resolutionIdempotencyKey" IS NULL AND "resolutionInputHash" IS NULL)
    OR ("status" IN ('regeneration-requested', 'dismissed') AND "openHeadKey" IS NULL AND "resolvedById" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolutionRationale" IS NOT NULL AND "resolutionIdempotencyKey" IS NOT NULL AND "resolutionInputHash" IS NOT NULL)
  );

ALTER TABLE "NodeIdentityProposal" DROP CONSTRAINT IF EXISTS "NodeIdentityProposal_status_check";

ALTER TABLE "NodeIdentityProposal" ADD CONSTRAINT "NodeIdentityProposal_status_check" CHECK (
    "kind" = 'same-claim' AND "sourceNodeId" <> "targetNodeId" AND "revision" >= 0
    AND (("status" = 'proposed' AND "revision" = 0 AND "reviewedById" IS NULL AND "reviewedAt" IS NULL AND "reviewNote" IS NULL)
      OR ("status" IN ('confirmed', 'rejected') AND "revision" >= 1 AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewNote" IS NOT NULL))
  );

CREATE OR REPLACE FUNCTION "oratlas_validate_synthesis_membership_reference"() RETURNS trigger AS $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM "SynthesisDraftCitation" c
      WHERE c."draftId" = NEW."draftId" AND c."referenceId" = NEW."referenceId"
        AND (c."nodeId" <> NEW."nodeId" OR c."nodeVersionId" <> NEW."nodeVersionId"
          OR (NEW."kind" = 'node' AND (c."identifierScheme" IS NOT NULL OR c."identifierRole" IS NOT NULL OR c."identifierValue" IS NOT NULL))
          OR (NEW."kind" = 'identifier' AND (c."identifierScheme" IS DISTINCT FROM NEW."identifierScheme" OR c."identifierRole" IS DISTINCT FROM NEW."identifierRole" OR c."identifierValue" IS DISTINCT FROM NEW."identifierValue")))
    ) THEN RAISE EXCEPTION 'Synthesis membership would invalidate stored citations'; END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "SynthesisDraftMembership_reference_guard" ON "SynthesisDraftMembership";

CREATE TRIGGER "SynthesisDraftMembership_reference_guard" BEFORE INSERT OR UPDATE ON "SynthesisDraftMembership"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_synthesis_membership_reference"();

CREATE OR REPLACE FUNCTION "oratlas_validate_synthesis_citation_reference"() RETURNS trigger AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM "SynthesisDraftMembership" m
      WHERE m."draftId" = NEW."draftId" AND m."referenceId" = NEW."referenceId"
        AND m."nodeId" = NEW."nodeId" AND m."nodeVersionId" = NEW."nodeVersionId"
        AND ((m."kind" = 'node' AND NEW."identifierScheme" IS NULL AND NEW."identifierRole" IS NULL AND NEW."identifierValue" IS NULL)
          OR (m."kind" = 'identifier' AND NEW."identifierScheme" IS NOT DISTINCT FROM m."identifierScheme" AND NEW."identifierRole" IS NOT DISTINCT FROM m."identifierRole" AND NEW."identifierValue" IS NOT DISTINCT FROM m."identifierValue"))
    ) THEN RAISE EXCEPTION 'Synthesis citation does not match its reference membership'; END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "SynthesisDraftCitation_reference_guard" ON "SynthesisDraftCitation";

CREATE TRIGGER "SynthesisDraftCitation_reference_guard" BEFORE INSERT OR UPDATE ON "SynthesisDraftCitation"
    FOR EACH ROW EXECUTE FUNCTION "oratlas_validate_synthesis_citation_reference"();
