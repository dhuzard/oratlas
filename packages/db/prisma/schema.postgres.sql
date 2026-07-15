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
    "snapshotId" TEXT NOT NULL,
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
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustAssessment_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "modelProvider" TEXT,
    "modelName" TEXT,
    "modelVersion" TEXT,
    "promptVersion" TEXT,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
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
CREATE UNIQUE INDEX "ReviewVersion_sourceSubmissionId_key" ON "ReviewVersion"("sourceSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewVersion_inspectionCaptureId_key" ON "ReviewVersion"("inspectionCaptureId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewVersion_reviewId_snapshotId_sourceSelectionKey_key" ON "ReviewVersion"("reviewId", "snapshotId", "sourceSelectionKey");

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
CREATE UNIQUE INDEX "Claim_reviewVersionId_localClaimId_key" ON "Claim"("reviewVersionId", "localClaimId");

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
CREATE INDEX "Citation_doi_idx" ON "Citation"("doi");

-- CreateIndex
CREATE UNIQUE INDEX "Citation_reviewVersionId_localCitationId_key" ON "Citation"("reviewVersionId", "localCitationId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimEvidenceRelation_claimId_citationId_relationType_key" ON "ClaimEvidenceRelation"("claimId", "citationId", "relationType");

-- CreateIndex
CREATE INDEX "TrustAssessment_reviewStatus_idx" ON "TrustAssessment"("reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "TrustVerification_trustAssessmentId_key" ON "TrustVerification"("trustAssessmentId");

-- CreateIndex
CREATE INDEX "TrustVerification_status_idx" ON "TrustVerification"("status");

-- CreateIndex
CREATE INDEX "TrustVerification_reviewerId_idx" ON "TrustVerification"("reviewerId");

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

-- AddForeignKey
ALTER TABLE "RepositorySnapshot" ADD CONSTRAINT "RepositorySnapshot_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_currentSnapshotId_fkey" FOREIGN KEY ("currentSnapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVersion" ADD CONSTRAINT "ReviewVersion_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVersion" ADD CONSTRAINT "ReviewVersion_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_reviewVersionId_fkey" FOREIGN KEY ("reviewVersionId") REFERENCES "ReviewVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidenceRelation" ADD CONSTRAINT "ClaimEvidenceRelation_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidenceRelation" ADD CONSTRAINT "ClaimEvidenceRelation_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "Citation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustAssessment" ADD CONSTRAINT "TrustAssessment_claimEvidenceRelationId_fkey" FOREIGN KEY ("claimEvidenceRelationId") REFERENCES "ClaimEvidenceRelation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustVerification" ADD CONSTRAINT "TrustVerification_trustAssessmentId_fkey" FOREIGN KEY ("trustAssessmentId") REFERENCES "TrustAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustVerification" ADD CONSTRAINT "TrustVerification_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

