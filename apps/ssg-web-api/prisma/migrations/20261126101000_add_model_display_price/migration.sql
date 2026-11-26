ALTER TABLE "ProductRevision" ADD COLUMN "modelPrice" DECIMAL(12,2);
ALTER TABLE "ProductRevision" ADD CONSTRAINT "model_price_positive"
  CHECK ("modelPrice" IS NULL OR ("modelPrice" > 0 AND "modelPrice" <> 'NaN'::numeric));

CREATE FUNCTION protect_model_price() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'draft' AND NEW."modelPrice" IS DISTINCT FROM OLD."modelPrice" THEN
    RAISE EXCEPTION 'published model display prices are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "model_price_immutability_guard"
  BEFORE UPDATE ON "ProductRevision"
  FOR EACH ROW EXECUTE FUNCTION protect_model_price();
