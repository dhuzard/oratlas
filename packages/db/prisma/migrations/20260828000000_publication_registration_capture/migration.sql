-- Registration and immutable capture of externally hosted publications
-- (expand only).
--
-- Adds the registration a manifest URL is observed through and the immutable
-- capture each observation produces, and gives an artifact capture its HTTP
-- provenance plus a link back to the observation that first retrieved those
-- exact bytes. No existing column is dropped, no row is rewritten and no
-- existing constraint is relaxed.
--
-- Registering a URL is not a claim to own the publication it names. Ownership
-- proof is a separate governance problem and nothing here encodes one.

-- AlterTable
ALTER TABLE "PublicationCapture" ADD COLUMN     "httpProvenanceJson" TEXT;
ALTER TABLE "PublicationCapture" ADD COLUMN     "registrationCaptureId" TEXT;

-- CreateTable
CREATE TABLE "PublicationRegistration" (
    "id" TEXT NOT NULL,
    "manifestUrl" TEXT NOT NULL,
    "publicationType" TEXT NOT NULL,
    "registeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicationRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationRegistrationCapture" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "captureKey" TEXT NOT NULL,
    "requestedManifestUrl" TEXT NOT NULL,
    "resolvedManifestUrl" TEXT NOT NULL,
    "observedSiteRootUrl" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "manifestProvenanceJson" TEXT NOT NULL,
    "declaredSchemaVersion" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL,
    "sourceLocalPublicationId" TEXT,
    "sourcesSha256" TEXT NOT NULL,
    "sourceDescriptorJson" TEXT,
    "structuralProvenance" TEXT NOT NULL,
    "sourceVerificationJson" TEXT NOT NULL,
    "warningsJson" TEXT NOT NULL,
    "publicationVersionId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationRegistrationCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicationCapture_registrationCaptureId_idx" ON "PublicationCapture"("registrationCaptureId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationRegistration_manifestUrl_key" ON "PublicationRegistration"("manifestUrl");

-- CreateIndex
CREATE INDEX "PublicationRegistration_registeredById_idx" ON "PublicationRegistration"("registeredById");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationRegistrationCapture_captureKey_key" ON "PublicationRegistrationCapture"("captureKey");

-- CreateIndex
CREATE INDEX "PublicationRegistrationCapture_registrationId_idx" ON "PublicationRegistrationCapture"("registrationId");

-- CreateIndex
CREATE INDEX "PublicationRegistrationCapture_publicationVersionId_idx" ON "PublicationRegistrationCapture"("publicationVersionId");

-- CreateIndex
CREATE INDEX "PublicationRegistrationCapture_sourcesSha256_idx" ON "PublicationRegistrationCapture"("sourcesSha256");

-- AddForeignKey
ALTER TABLE "PublicationCapture" ADD CONSTRAINT "PublicationCapture_registrationCaptureId_fkey" FOREIGN KEY ("registrationCaptureId") REFERENCES "PublicationRegistrationCapture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationRegistration" ADD CONSTRAINT "PublicationRegistration_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationRegistrationCapture" ADD CONSTRAINT "PublicationRegistrationCapture_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "PublicationRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationRegistrationCapture" ADD CONSTRAINT "PublicationRegistrationCapture_publicationVersionId_fkey" FOREIGN KEY ("publicationVersionId") REFERENCES "PublicationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
