ALTER TABLE "ProductTranslation"
  ADD COLUMN "seoTitle" VARCHAR(250),
  ADD COLUMN "seoDescription" VARCHAR(1000),
  ADD COLUMN "ogImageId" UUID;

ALTER TABLE "ContentTranslation"
  ADD COLUMN "ogImageId" UUID,
  ADD COLUMN "articleModifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "hasBeenPublished" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "publicProjectionHash" VARCHAR(64),
  ADD COLUMN "articleProjectionHash" VARCHAR(64);

-- Existing public timestamps are retained; they are not evidence of an article edit.
UPDATE "ContentTranslation"
SET "hasBeenPublished" = true
WHERE published OR "publishedAt" IS NOT NULL;
