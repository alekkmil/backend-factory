UPDATE "ContentRecord"
SET "specialData" =
  ("specialData" - 'source_url' - 'source_date') ||
  jsonb_build_object(
    'group', 'media',
    'event_at', COALESCE("specialData"->'event_at', "specialData"->'source_date', 'null'::jsonb),
    'sources', COALESCE(
      "specialData"->'sources',
      CASE
        WHEN jsonb_typeof("specialData"->'source_url') = 'string'
          THEN jsonb_build_array("specialData"->'source_url')
        ELSE '[]'::jsonb
      END
    ),
    'show_on_home', COALESCE("specialData"->'show_on_home', 'false'::jsonb),
    'home_order', COALESCE("specialData"->'home_order', 'null'::jsonb),
    'is_featured', COALESCE("specialData"->'is_featured', 'false'::jsonb),
    'is_pinned', COALESCE("specialData"->'is_pinned', 'false'::jsonb),
    'pin_order', COALESCE("specialData"->'pin_order', 'null'::jsonb),
    'topics', COALESCE("specialData"->'topics', '[]'::jsonb)
  )
WHERE type = 'press';

UPDATE "ContentRecord"
SET "specialData" = "specialData" || jsonb_build_object(
    'group', 'stories',
    'show_on_home', COALESCE("specialData"->'show_on_home', 'false'::jsonb),
    'home_order', COALESCE("specialData"->'home_order', 'null'::jsonb),
    'is_featured', COALESCE("specialData"->'is_featured', 'false'::jsonb),
    'is_pinned', COALESCE("specialData"->'is_pinned', 'false'::jsonb),
    'pin_order', COALESCE("specialData"->'pin_order', 'null'::jsonb),
    'topics', COALESCE("specialData"->'topics', '[]'::jsonb)
  )
WHERE type IN ('article', 'case_study');

UPDATE "PublicRoute"
SET path = replace(path, '/светът-на-ссг', '/светът-на-ssg'),
    "changedAt" = CURRENT_TIMESTAMP
WHERE path LIKE '/светът-на-ссг%';

UPDATE "PublicRoute"
SET path = '/за-ssg',
    "changedAt" = CURRENT_TIMESTAMP
WHERE path = '/за-ссг';

UPDATE "DictionaryEntry"
SET "labelBg" = CASE code
  WHEN 'white' THEN 'Бяло'
  WHEN 'yellow' THEN 'Жълто'
  WHEN 'rose' THEN 'Розово'
END
WHERE "group" = 'material_colour'
  AND code IN ('white', 'yellow', 'rose');
