CREATE OR REPLACE FUNCTION validate_stock_sale_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  stock_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'StockSale' THEN
    stock_id := NEW."stockItemId";
  ELSE
    stock_id := NEW.id;
  END IF;
  IF EXISTS (SELECT 1 FROM "StockSale" WHERE "stockItemId" = stock_id)
    AND NOT EXISTS (SELECT 1 FROM "StockItem" WHERE id = stock_id AND status = 'sold') THEN
    RAISE EXCEPTION 'a stock item with an immutable sale fact must remain sold';
  END IF;
  RETURN NULL;
END;
$$;
