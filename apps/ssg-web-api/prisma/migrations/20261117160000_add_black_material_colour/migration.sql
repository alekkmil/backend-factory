INSERT INTO "DictionaryEntry" (
  id, "group", code, "labelBg", "labelEn", "appliesTo", active, "updatedAt"
)
VALUES (
  gen_random_uuid(), 'material_colour', 'black', 'Черно', 'Black',
  ARRAY[]::text[], true, CURRENT_TIMESTAMP
)
ON CONFLICT ("group", code) DO UPDATE
SET "labelBg" = EXCLUDED."labelBg",
    "labelEn" = EXCLUDED."labelEn",
    active = true,
    "updatedAt" = CURRENT_TIMESTAMP;
