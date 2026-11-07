BEGIN;

CREATE OR REPLACE FUNCTION validate_product_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type "ProductType";
  release_product uuid;
  release_approved boolean;
  translation_count integer;
  image_count integer;
BEGIN
  SELECT * INTO NEW FROM "ProductRevision" WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT "productType" INTO owner_type FROM "Product" WHERE id = NEW."productId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product revision owner does not exist';
  END IF;
  IF owner_type = 'jewellery' THEN
    IF (NEW."jewelleryTypeId" IS NULL AND NEW.state = 'published')
      OR (NEW."jewelleryTypeId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "DictionaryEntry"
        WHERE id = NEW."jewelleryTypeId" AND "group" = 'jewellery_type' AND active
      )) THEN
      RAISE EXCEPTION 'released jewellery requires an active jewellery_type dictionary entry';
    END IF;
  ELSIF NEW."jewelleryTypeId" IS NOT NULL THEN
    RAISE EXCEPTION 'loose-stone revisions cannot have a jewellery type';
  END IF;

  IF NEW."materialsState" IN ('unknown', 'none')
    AND EXISTS (SELECT 1 FROM "RevisionMaterial" WHERE "revisionId" = NEW.id) THEN
    RAISE EXCEPTION 'unknown or empty material state cannot contain material rows';
  ELSIF NEW."materialsState" = 'known'
    AND NOT EXISTS (SELECT 1 FROM "RevisionMaterial" WHERE "revisionId" = NEW.id) THEN
    RAISE EXCEPTION 'known material state requires material rows';
  END IF;

  IF NEW."gemstonesState" IN ('unknown', 'none')
    AND EXISTS (SELECT 1 FROM "RevisionGemstone" WHERE "revisionId" = NEW.id) THEN
    RAISE EXCEPTION 'unknown or empty gemstone state cannot contain gemstone rows';
  ELSIF NEW."gemstonesState" = 'known'
    AND NOT EXISTS (SELECT 1 FROM "RevisionGemstone" WHERE "revisionId" = NEW.id) THEN
    RAISE EXCEPTION 'known gemstone state requires gemstone rows';
  END IF;

  IF NEW."mediaReleaseId" IS NOT NULL THEN
    SELECT "productId", approved INTO release_product, release_approved
    FROM "MediaRelease" WHERE id = NEW."mediaReleaseId";
    IF NOT FOUND OR release_product <> NEW."productId" THEN
      RAISE EXCEPTION 'product revision media release must belong to its product';
    END IF;
  ELSE
    release_approved := false;
  END IF;

  IF NEW.state = 'published' THEN
    IF owner_type = 'loose_stone'
      AND (NEW."gemstonesState" <> 'known' OR NOT EXISTS (
        SELECT 1 FROM "RevisionGemstone" WHERE "revisionId" = NEW.id
      )) THEN
      RAISE EXCEPTION 'published loose stones require confirmed gemstone codes';
    END IF;
    IF NOT release_approved OR NEW."mediaReleaseId" IS NULL THEN
      RAISE EXCEPTION 'published products require their approved media release';
    END IF;
    SELECT count(*) INTO translation_count
    FROM "ProductTranslation"
    WHERE "revisionId" = NEW.id
      AND "name" IS NOT NULL AND length(btrim("name")) > 0
      AND "description" IS NOT NULL AND length(btrim("description")) > 0
      AND "slug" IS NOT NULL AND length(btrim("slug")) > 0;
    IF translation_count <> 2 THEN
      RAISE EXCEPTION 'published products require complete Bulgarian and English translations';
    END IF;
    SELECT count(*) INTO image_count
    FROM "RevisionImage" ri
    JOIN "MediaAsset" ma ON ma.id = ri."assetId"
    WHERE ri."revisionId" = NEW.id
      AND ma."releaseId" = NEW."mediaReleaseId"
      AND ma."reviewStatus" = 'approved';
    IF image_count = 0 OR EXISTS (
      SELECT 1 FROM "RevisionImage" ri
      JOIN "MediaAsset" ma ON ma.id = ri."assetId"
      WHERE ri."revisionId" = NEW.id
        AND (ma."releaseId" IS DISTINCT FROM NEW."mediaReleaseId"
          OR ma."reviewStatus" <> 'approved')
    ) OR (SELECT count(*) FROM "RevisionImage" ri
      JOIN "MediaAsset" ma ON ma.id = ri."assetId"
      WHERE ri."revisionId" = NEW.id AND ma.role = 'main') <> 1
      OR NOT EXISTS (
      SELECT 1 FROM "RevisionImage" ri
      JOIN "MediaAsset" ma ON ma.id = ri."assetId"
      WHERE ri."revisionId" = NEW.id AND ri."sortOrder" = 1
        AND ma.role = 'main' AND ma."reviewStatus" = 'approved'
        AND ma."releaseId" = NEW."mediaReleaseId"
    ) THEN
      RAISE EXCEPTION 'published products require an approved main image';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "Product"
      WHERE id = NEW."productId" AND "currentRevisionId" = NEW.id
        AND "publicationStatus" IN ('published', 'hidden')
    ) THEN
      RAISE EXCEPTION 'published revision must be current for a released or hidden product';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM "Product" WHERE "currentRevisionId" = NEW.id
  ) THEN
    RAISE EXCEPTION 'a product current revision must be published';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_product_current_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT * INTO NEW FROM "Product" WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NEW."publicationStatus" = 'published' AND NEW."currentRevisionId" IS NULL THEN
    RAISE EXCEPTION 'published product requires a current revision';
  END IF;
  IF NEW."currentRevisionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ProductRevision"
    WHERE id = NEW."currentRevisionId" AND "productId" = NEW.id AND state = 'published'
  ) THEN
    RAISE EXCEPTION 'current revision must belong to the product and be published';
  END IF;
  RETURN NEW;
END;
$$;

DROP INDEX "one_draft_per_product";
ALTER TABLE "ProductRevision"
  ADD CONSTRAINT "one_draft_per_product"
  EXCLUDE USING btree ("productId" WITH =)
  WHERE (state = 'draft')
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION protect_product_translation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  revision_state "RevisionState";
BEGIN
  SELECT state INTO revision_state FROM "ProductRevision"
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."revisionId" ELSE NEW."revisionId" END;
  IF revision_state <> 'draft' THEN
    IF TG_OP = 'UPDATE' AND revision_state = 'published'
      AND (to_jsonb(NEW) - 'publicModifiedAt') = (to_jsonb(OLD) - 'publicModifiedAt')
      AND EXISTS (
        SELECT 1 FROM "Product"
        WHERE "currentRevisionId" = NEW."revisionId" AND "publicationStatus" = 'published'
      ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'translations on a published revision are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
