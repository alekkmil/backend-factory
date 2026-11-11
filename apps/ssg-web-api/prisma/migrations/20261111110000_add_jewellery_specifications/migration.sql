ALTER TABLE "ProductRevision" ADD COLUMN "specifications" JSONB;
ALTER TABLE "ProductRevision" ADD CONSTRAINT "product_specifications_object"
  CHECK ("specifications" IS NULL OR jsonb_typeof("specifications") = 'object');

CREATE FUNCTION protect_product_specifications() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'draft' AND NEW."specifications" IS DISTINCT FROM OLD."specifications" THEN
    RAISE EXCEPTION 'published product specifications are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "product_specifications_immutability_guard"
  BEFORE UPDATE ON "ProductRevision"
  FOR EACH ROW EXECUTE FUNCTION protect_product_specifications();

INSERT INTO "DictionaryEntry" (id, "group", code, "labelBg", "labelEn", "appliesTo", "updatedAt")
SELECT gen_random_uuid(), entries."group", entries.code, entries.bg, entries.en,
  ARRAY[]::text[], CURRENT_TIMESTAMP
FROM (VALUES
  ('material_colour', 'yellow', 'Жълт', 'Yellow'),
  ('material_colour', 'white', 'Бял', 'White'),
  ('material_colour', 'rose', 'Розов', 'Rose'),
  ('stone_colour', 'colourless', 'Безцветен', 'Colourless'),
  ('stone_colour', 'blue', 'Син', 'Blue'),
  ('stone_colour', 'red', 'Червен', 'Red'),
  ('stone_colour', 'green', 'Зелен', 'Green'),
  ('stone_grade', 'D', 'D', 'D'),
  ('stone_grade', 'E', 'E', 'E'),
  ('stone_grade', 'F', 'F', 'F'),
  ('stone_grade', 'G', 'G', 'G'),
  ('stone_grade', 'H', 'H', 'H'),
  ('stone_clarity', 'FL', 'FL', 'FL'),
  ('stone_clarity', 'IF', 'IF', 'IF'),
  ('stone_clarity', 'VVS1', 'VVS1', 'VVS1'),
  ('stone_clarity', 'VVS2', 'VVS2', 'VVS2'),
  ('stone_clarity', 'VS1', 'VS1', 'VS1'),
  ('stone_clarity', 'VS2', 'VS2', 'VS2'),
  ('stone_clarity', 'SI1', 'SI1', 'SI1'),
  ('stone_clarity', 'SI2', 'SI2', 'SI2'),
  ('stone_shape', 'round', 'Кръгъл', 'Round'),
  ('stone_shape', 'oval', 'Овал', 'Oval'),
  ('stone_shape', 'princess', 'Принцеса', 'Princess'),
  ('stone_shape', 'emerald', 'Емералд', 'Emerald'),
  ('stone_shape', 'pear', 'Капка', 'Pear'),
  ('stone_shape', 'cushion', 'Кушън', 'Cushion'),
  ('pearl_type', 'freshwater', 'Сладководна перла', 'Freshwater pearl'),
  ('pearl_type', 'akoya', 'Акоя', 'Akoya'),
  ('pearl_type', 'tahitian', 'Таитянска перла', 'Tahitian pearl'),
  ('pearl_type', 'south_sea', 'Южноморска перла', 'South Sea pearl'),
  ('finish', 'polished', 'Полиран', 'Polished'),
  ('finish', 'matte', 'Матиран', 'Matte'),
  ('finish', 'brushed', 'Сатениран', 'Brushed'),
  ('finish', 'hammered', 'Кован', 'Hammered'),
  ('construction_detail', 'hollow', 'Куха конструкция', 'Hollow construction'),
  ('construction_detail', 'solid', 'Плътна конструкция', 'Solid construction'),
  ('construction_detail', 'openwork', 'Ажур', 'Openwork'),
  ('construction_detail', 'articulated', 'Подвижни елементи', 'Articulated')
) AS entries("group", code, bg, en)
ON CONFLICT ("group", code) DO NOTHING;
