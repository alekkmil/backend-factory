CREATE TABLE "WebsiteMediaRelease" (
  "id" UUID NOT NULL,
  "versionLabel" VARCHAR(30) NOT NULL,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "reviewedById" UUID,
  "reviewedAt" TIMESTAMPTZ(3),
  "receiptSha256" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebsiteMediaRelease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebsiteMediaAsset" (
  "id" UUID NOT NULL,
  "releaseId" UUID NOT NULL,
  "logicalImageId" VARCHAR(80) NOT NULL,
  "role" "MediaRole" NOT NULL,
  "originalPrivatePath" VARCHAR(1000) NOT NULL,
  "derivatives" JSONB NOT NULL,
  "altBg" VARCHAR(500) NOT NULL,
  "altEn" VARCHAR(500) NOT NULL,
  "processedWithAi" BOOLEAN NOT NULL DEFAULT false,
  "onModelIllustrative" BOOLEAN NOT NULL DEFAULT false,
  "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'draft',
  "reviewedById" UUID,
  "reviewedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebsiteMediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsiteMediaRelease_versionLabel_key"
  ON "WebsiteMediaRelease"("versionLabel");
CREATE UNIQUE INDEX "WebsiteMediaAsset_releaseId_logicalImageId_key"
  ON "WebsiteMediaAsset"("releaseId", "logicalImageId");
CREATE INDEX "WebsiteMediaRelease_reviewedById_idx"
  ON "WebsiteMediaRelease"("reviewedById");
CREATE INDEX "WebsiteMediaAsset_reviewedById_idx"
  ON "WebsiteMediaAsset"("reviewedById");

ALTER TABLE "WebsiteMediaRelease"
  ADD CONSTRAINT "WebsiteMediaRelease_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "Principal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebsiteMediaAsset"
  ADD CONSTRAINT "WebsiteMediaAsset_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "WebsiteMediaRelease"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WebsiteMediaAsset"
  ADD CONSTRAINT "WebsiteMediaAsset_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "Principal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION protect_website_media_release() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.approved THEN
    RAISE EXCEPTION 'approved website media releases are immutable and retained';
  END IF;
  IF NEW.id <> OLD.id OR NEW."versionLabel" <> OLD."versionLabel" OR
     NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'website media release identity is immutable';
  END IF;
  IF NEW.approved AND (NEW."reviewedById" IS NULL OR NEW."reviewedAt" IS NULL OR
     NEW."receiptSha256" IS NULL) THEN
    RAISE EXCEPTION 'approved website media release requires review evidence';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "website_media_release_immutability_guard"
  BEFORE UPDATE OR DELETE ON "WebsiteMediaRelease"
  FOR EACH ROW EXECUTE FUNCTION protect_website_media_release();

CREATE FUNCTION protect_website_media_asset() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  release_approved boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'website media assets are immutable and retained';
  END IF;
  SELECT approved INTO release_approved
    FROM "WebsiteMediaRelease" WHERE id = NEW."releaseId";
  IF release_approved IS DISTINCT FROM false OR
     NEW."reviewStatus" <> 'approved' OR NEW."reviewedById" IS NULL OR
     NEW."reviewedAt" IS NULL THEN
    RAISE EXCEPTION 'website media asset requires a pending release and review';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "website_media_asset_immutability_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "WebsiteMediaAsset"
  FOR EACH ROW EXECUTE FUNCTION protect_website_media_asset();
