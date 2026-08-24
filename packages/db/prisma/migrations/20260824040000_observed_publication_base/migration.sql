-- Keep publisher-declared canonical addressing separate from the deterministic
-- base ORAtlas observed while capturing the publication manifest. Existing
-- Phase-2 rows remain nullable and resolve through their immutable manifest
-- capture; every new registration writes this value at version creation.
ALTER TABLE "PublicationVersion" ADD COLUMN "observedPublicationBaseUrl" TEXT;
