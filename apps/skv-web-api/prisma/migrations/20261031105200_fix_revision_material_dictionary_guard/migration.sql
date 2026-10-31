CREATE OR REPLACE FUNCTION validate_revision_material() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  revision_state "RevisionState";
  material_code text;
  material_group text;
  fineness_group text;
  fineness_applies text[];
  karat_group text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT state INTO revision_state FROM "ProductRevision" WHERE id = OLD."revisionId";
    IF revision_state <> 'draft' THEN
      RAISE EXCEPTION 'composition on a published revision is immutable';
    END IF;
    RETURN OLD;
  END IF;
  SELECT state INTO revision_state FROM "ProductRevision" WHERE id = NEW."revisionId";
  IF revision_state <> 'draft' THEN
    RAISE EXCEPTION 'composition on a published revision is immutable';
  END IF;
  SELECT code, "group" INTO material_code, material_group
  FROM "DictionaryEntry" WHERE id = NEW."materialId" AND active;
  IF material_group IS DISTINCT FROM 'material' THEN
    RAISE EXCEPTION 'materialId must reference an active material dictionary entry';
  END IF;
  IF NEW."finenessId" IS NOT NULL THEN
    SELECT "group", "appliesTo" INTO fineness_group, fineness_applies
    FROM "DictionaryEntry" WHERE id = NEW."finenessId" AND active;
    IF fineness_group IS DISTINCT FROM 'fineness'
      OR material_code IS NULL
      OR NOT material_code = ANY(fineness_applies) THEN
      RAISE EXCEPTION 'fineness dictionary entry does not apply to the selected material';
    END IF;
  END IF;
  IF NEW."goldKaratId" IS NOT NULL THEN
    SELECT "group" INTO karat_group FROM "DictionaryEntry"
    WHERE id = NEW."goldKaratId" AND active;
    IF material_code IS DISTINCT FROM 'gold'
      OR karat_group IS DISTINCT FROM 'gold_karat' THEN
      RAISE EXCEPTION 'gold karat applies only to gold';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
