ALTER TABLE "OrderLine" ADD COLUMN "staffSnapshot" JSONB;

CREATE FUNCTION protect_order_line_staff_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."staffSnapshot" IS DISTINCT FROM OLD."staffSnapshot" THEN
    RAISE EXCEPTION 'submitted order line staff snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "order_line_staff_snapshot_immutability_guard"
  BEFORE UPDATE ON "OrderLine"
  FOR EACH ROW EXECUTE FUNCTION protect_order_line_staff_snapshot();
