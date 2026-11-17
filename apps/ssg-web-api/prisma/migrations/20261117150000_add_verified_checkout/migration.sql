CREATE TYPE "BankPaymentOutcome" AS ENUM ('pending', 'paid', 'failed');

CREATE TABLE "BankPaymentAttempt" (
  "id" UUID PRIMARY KEY,
  "orderId" UUID NOT NULL UNIQUE REFERENCES "Order"("id") ON DELETE RESTRICT,
  "gatewaySequence" BIGSERIAL NOT NULL UNIQUE,
  "bankOrder" VARCHAR(6) NOT NULL,
  "terminal" VARCHAR(8) NOT NULL,
  "gatewayUrl" VARCHAR(255) NOT NULL,
  "nonce" VARCHAR(32) NOT NULL UNIQUE,
  "requestTimestamp" VARCHAR(14) NOT NULL,
  "formFields" JSONB NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" > 0),
  "currency" VARCHAR(3) NOT NULL CHECK ("currency" = 'EUR'),
  "outcome" "BankPaymentOutcome" NOT NULL DEFAULT 'pending',
  "paidAt" TIMESTAMPTZ(3),
  "lastReconciledAt" TIMESTAMPTZ(3),
  "nextReconcileAt" TIMESTAMPTZ(3),
  "reconcileLeaseUntil" TIMESTAMPTZ(3),
  "notificationQueuedAt" TIMESTAMPTZ(3),
  "customerMessage" VARCHAR(1024),
  "manualReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CHECK ("bankOrder" ~ '^[0-9]{6}$' AND "terminal" ~ '^[A-Za-z0-9]{8}$'
    AND "nonce" ~ '^[0-9A-F]{32}$' AND "requestTimestamp" ~ '^[0-9]{14}$'),
  CHECK (("outcome" = 'paid') = ("paidAt" IS NOT NULL))
);
CREATE INDEX "BankPaymentAttempt_terminal_bankOrder_createdAt_idx"
  ON "BankPaymentAttempt"("terminal", "bankOrder", "createdAt");
CREATE INDEX "BankPaymentAttempt_outcome_nextReconcileAt_idx"
  ON "BankPaymentAttempt"("outcome", "nextReconcileAt");
CREATE INDEX "BankPaymentAttempt_outcome_notificationQueuedAt_updatedAt_idx"
  ON "BankPaymentAttempt"("outcome", "notificationQueuedAt", "updatedAt");

CREATE TABLE "BankPaymentEvent" (
  "id" UUID PRIMARY KEY,
  "attemptId" UUID NOT NULL REFERENCES "BankPaymentAttempt"("id") ON DELETE RESTRICT,
  "eventHash" VARCHAR(64) NOT NULL,
  "source" VARCHAR(16) NOT NULL CHECK ("source" IN ('callback', 'inquiry')),
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("attemptId", "eventHash")
);
CREATE TRIGGER "bank_payment_event_immutable"
  BEFORE UPDATE OR DELETE ON "BankPaymentEvent"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE FUNCTION protect_bank_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank payment attempts cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.terminal));
    IF NOT EXISTS (SELECT 1 FROM "Order" WHERE id = NEW."orderId" AND NOT sandbox
        AND total = NEW.amount AND currency = NEW.currency)
       OR NEW.amount > 2000
       OR EXISTS (
         SELECT 1 FROM "BankPaymentAttempt"
         WHERE terminal = NEW.terminal AND "bankOrder" = NEW."bankOrder"
           AND "createdAt" > NEW."createdAt" - INTERVAL '24 hours'
       ) OR EXISTS (
         SELECT 1 FROM "SandboxPaymentAttempt"
         WHERE terminal = NEW.terminal
           AND lpad("gatewaySequence"::text, 6, '0') = NEW."bankOrder"
           AND "createdAt" > NEW."createdAt" - INTERVAL '24 hours'
       ) THEN
      RAISE EXCEPTION 'bank order identity unavailable';
    END IF;
  ELSIF ROW(NEW.id, NEW."orderId", NEW."gatewaySequence", NEW."bankOrder", NEW.terminal,
      NEW."gatewayUrl", NEW.nonce, NEW."requestTimestamp", NEW."formFields", NEW.amount, NEW.currency, NEW."createdAt")
    IS DISTINCT FROM
    ROW(OLD.id, OLD."orderId", OLD."gatewaySequence", OLD."bankOrder", OLD.terminal,
      OLD."gatewayUrl", OLD.nonce, OLD."requestTimestamp", OLD."formFields", OLD.amount, OLD.currency, OLD."createdAt")
    OR (OLD.outcome = 'paid' AND ROW(NEW.outcome, NEW."paidAt") IS DISTINCT FROM ROW(OLD.outcome, OLD."paidAt")) THEN
    RAISE EXCEPTION 'bank payment identity and successful outcome are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "bank_payment_guard" BEFORE INSERT OR UPDATE OR DELETE
  ON "BankPaymentAttempt" FOR EACH ROW EXECUTE FUNCTION protect_bank_payment();

CREATE FUNCTION validate_checkout_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Order" WHERE id = NEW."orderId" AND NOT sandbox)
    AND NOT EXISTS (
      SELECT 1 FROM "StockItem" WHERE id = NEW."stockItemId"
        AND status = 'reserved' AND "reservationReference" = NEW."reservationReference"
        AND "locationCode" = NEW."reservedLocation"
    ) THEN
    RAISE EXCEPTION 'checkout requires ownership of every exact stock reservation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "checkout_reservation_guard"
  AFTER INSERT ON "OrderLine" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_checkout_reservation();
