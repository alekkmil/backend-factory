CREATE TABLE "RevisionSetProduct" (
  "id" UUID NOT NULL,
  "revisionId" UUID NOT NULL,
  "relatedProductId" UUID NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "RevisionSetProduct_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "revision_set_sort_range" CHECK ("sortOrder" BETWEEN 1 AND 5),
  CONSTRAINT "RevisionSetProduct_revisionId_fkey" FOREIGN KEY ("revisionId")
    REFERENCES "ProductRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RevisionSetProduct_relatedProductId_fkey" FOREIGN KEY ("relatedProductId")
    REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RevisionSetProduct_revisionId_relatedProductId_key"
  ON "RevisionSetProduct"("revisionId", "relatedProductId");
CREATE UNIQUE INDEX "RevisionSetProduct_revisionId_sortOrder_key"
  ON "RevisionSetProduct"("revisionId", "sortOrder");
CREATE INDEX "RevisionSetProduct_relatedProductId_idx" ON "RevisionSetProduct"("relatedProductId");

CREATE FUNCTION validate_revision_set_product() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_id UUID;
  revision_state "RevisionState";
  owner_type "ProductType";
  target_type "ProductType";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'set product links must be replaced on a draft';
  END IF;
  SELECT r."productId", r.state, p."productType"
    INTO owner_id, revision_state, owner_type
    FROM "ProductRevision" r JOIN "Product" p ON p.id = r."productId"
    WHERE r.id = CASE WHEN TG_OP = 'DELETE' THEN OLD."revisionId" ELSE NEW."revisionId" END
    FOR UPDATE OF r;
  IF revision_state IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'set product links on a published revision are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT "productType" INTO target_type FROM "Product" WHERE id = NEW."relatedProductId";
  IF owner_type IS DISTINCT FROM 'jewellery' OR target_type IS DISTINCT FROM 'jewellery'
    OR owner_id = NEW."relatedProductId" THEN
    RAISE EXCEPTION 'set links require distinct jewellery products';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "revision_set_product_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "RevisionSetProduct"
  FOR EACH ROW EXECUTE FUNCTION validate_revision_set_product();
