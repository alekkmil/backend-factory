BEGIN;

DO $$
DECLARE
  publication_count integer;
BEGIN
  LOCK TABLE "ContentRecord" IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO publication_count
  FROM "ContentRecord"
  WHERE key IN (
    'story_ssg_runway_2026', 'story_ssg_33_years', 'story_ssg_young_artists',
    'press_cannes_2025', 'press_mirela_economic_2025', 'press_kambarev_2024'
  ) OR id IN (
    'a530c42e-1f3b-42f7-871b-33c84d8a42d2',
    'b33ea251-0904-41a9-ba0d-955243cb6ae5',
    'b0d71b09-8c42-46ff-8477-c4d21fc65afd'
  );

  IF publication_count = 0 THEN
    RAISE NOTICE 'No existing SSG publication records; no group correction required';
    RETURN;
  END IF;

  IF publication_count <> 6 OR EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('press_cannes_2025', 'a530c42e-1f3b-42f7-871b-33c84d8a42d2'::uuid),
        ('press_mirela_economic_2025', 'b33ea251-0904-41a9-ba0d-955243cb6ae5'::uuid),
        ('press_kambarev_2024', 'b0d71b09-8c42-46ff-8477-c4d21fc65afd'::uuid)
    ) AS expected(key, id)
    LEFT JOIN "ContentRecord" AS record
      ON record.key = expected.key AND record.id = expected.id
    WHERE record.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM "ContentRecord"
    WHERE key IN (
      'story_ssg_runway_2026', 'story_ssg_33_years', 'story_ssg_young_artists',
      'press_cannes_2025', 'press_mirela_economic_2025', 'press_kambarev_2024'
    ) AND (
      type NOT IN ('article', 'case_study', 'press')
      OR jsonb_typeof("specialData") IS DISTINCT FROM 'object'
      OR "specialData"->>'kind' IS DISTINCT FROM type::text
    )
  ) THEN
    RAISE EXCEPTION 'Expected six existing SSG publications with matching media IDs, keys and content kinds';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "ContentRecord"
    WHERE type IN ('article', 'case_study', 'press')
      AND "specialData"->'is_featured' = 'true'::jsonb
      AND key NOT IN (
        'story_ssg_runway_2026', 'story_ssg_33_years', 'story_ssg_young_artists',
        'press_cannes_2025', 'press_mirela_economic_2025', 'press_kambarev_2024'
      )
  ) THEN
    RAISE EXCEPTION 'Another publication is already featured; review the landing lead before correcting SSG groups';
  END IF;

  UPDATE "ContentRecord" AS record
  SET "specialData" = record."specialData" || jsonb_build_object(
        'group', 'media',
        'publisher', expected.publisher,
        'is_featured', false
      ),
      "updatedAt" = CURRENT_TIMESTAMP
  FROM (
    VALUES
      ('press_cannes_2025', 'CodeFashion'),
      ('press_mirela_economic_2025', 'Economic.bg'),
      ('press_kambarev_2024', 'Impressio.dir.bg')
  ) AS expected(key, publisher)
  WHERE record.key = expected.key;

  UPDATE "ContentRecord"
  SET "specialData" = ("specialData" - 'publisher') || jsonb_build_object(
        'group', 'stories',
        'is_featured', key = 'story_ssg_runway_2026'
      ),
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE key IN (
    'story_ssg_runway_2026', 'story_ssg_33_years', 'story_ssg_young_artists'
  );
END;
$$;

COMMIT;
