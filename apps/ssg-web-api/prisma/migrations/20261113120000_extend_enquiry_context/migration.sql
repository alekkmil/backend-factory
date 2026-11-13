BEGIN;

ALTER TABLE "Inquiry"
  ADD COLUMN "openingAction" VARCHAR(80),
  ADD COLUMN "originPath" VARCHAR(1000),
  ADD COLUMN "originEntity" JSONB,
  ADD COLUMN "contextSnapshot" JSONB;

ALTER TABLE "Inquiry" DROP CONSTRAINT "inquiry_one_context";
ALTER TABLE "Inquiry" ADD CONSTRAINT "inquiry_context"
  CHECK ("storeCode" IS NULL OR ("productId" IS NULL AND "contentId" IS NULL));

COMMIT;
