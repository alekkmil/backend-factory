BEGIN;

LOCK TABLE "Product", "ProductTranslation", "PublicRoute" IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION protect_public_route_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'public route history cannot be deleted';
  END IF;
  IF ROW(NEW.id, NEW.path, NEW.locale, NEW."productId", NEW."contentId", NEW."createdAt")
    IS DISTINCT FROM
    ROW(OLD.id, OLD.path, OLD.locale, OLD."productId", OLD."contentId", OLD."createdAt") THEN
    RAISE EXCEPTION 'public route path and owner are immutable';
  END IF;
  IF OLD.state <> NEW.state AND NOT (
    (OLD.state = 'current' AND NEW.state IN ('redirect', 'gone')) OR
    (OLD.state = 'redirect' AND NEW.state = 'current' AND OLD."productId" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'public route state transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TEMP TABLE product_path_migration ON COMMIT DROP AS
SELECT
  route.id AS route_id,
  route.path AS old_path,
  route.locale,
  product.id AS product_id,
  product."ssgId" AS ssg_id,
  translation.slug,
  CASE
    WHEN product."productType" = 'jewellery' AND route.locale = 'bg' THEN '/бижута/'
    WHEN product."productType" = 'jewellery' AND route.locale = 'en' THEN '/en/jewelry/'
    WHEN product."productType" = 'loose_stone' AND route.locale = 'bg' THEN '/скъпоценни-камъни/'
    WHEN product."productType" = 'loose_stone' AND route.locale = 'en' THEN '/en/gemstones/'
  END || translation.slug || '-' || product."ssgId" AS new_path
FROM "PublicRoute" AS route
JOIN "Product" AS product ON product.id = route."productId"
LEFT JOIN "ProductTranslation" AS translation
  ON translation."revisionId" = product."currentRevisionId" AND translation.locale = route.locale
WHERE route.state = 'current' AND route."productId" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Product" AS product
    WHERE product."publicationStatus" IN ('published', 'hidden')
      AND (
        product."currentRevisionId" IS NULL OR
        (SELECT count(*) FROM product_path_migration AS paths WHERE paths.product_id = product.id) <> 2
      )
  ) THEN
    RAISE EXCEPTION 'Cannot migrate product paths: published or hidden product is missing its current routes or revision';
  END IF;
  IF EXISTS (
    SELECT 1 FROM product_path_migration
    WHERE slug IS NULL OR slug = '' OR new_path IS NULL OR
      ssg_id !~ '^[A-Za-z0-9-]+$' OR
      slug ~ '[/\\%?#[:cntrl:]]' OR length(new_path) > 1000
  ) THEN
    RAISE EXCEPTION 'Cannot migrate product paths: invalid product code or published slug';
  END IF;
  IF EXISTS (
    SELECT 1 FROM product_path_migration GROUP BY new_path HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM product_path_migration AS paths
    JOIN "PublicRoute" AS owner ON owner.path = paths.new_path
    WHERE owner.id <> paths.route_id AND
      (owner."productId" IS DISTINCT FROM paths.product_id OR
       owner.locale <> paths.locale OR owner.state <> 'redirect')
  ) THEN
    RAISE EXCEPTION 'Cannot migrate product paths: canonical route conflicts with existing route history';
  END IF;
END;
$$;

UPDATE "PublicRoute" AS route
SET state = 'redirect', "changedAt" = CURRENT_TIMESTAMP
FROM product_path_migration AS paths
WHERE route.id = paths.route_id AND paths.old_path <> paths.new_path;

UPDATE "PublicRoute" AS route
SET state = 'current', "changedAt" = CURRENT_TIMESTAMP
FROM product_path_migration AS paths
WHERE route.path = paths.new_path AND route.state = 'redirect'
  AND route."productId" = paths.product_id AND route.locale = paths.locale;

INSERT INTO "PublicRoute" (id, path, locale, state, "productId", "contentId", "changedAt", "createdAt")
SELECT gen_random_uuid(), paths.new_path, paths.locale, 'current', paths.product_id, NULL,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM product_path_migration AS paths
WHERE NOT EXISTS (SELECT 1 FROM "PublicRoute" AS route WHERE route.path = paths.new_path);

COMMIT;
