CREATE TYPE "SandboxPaymentStatus" AS ENUM ('pending', 'paid');

ALTER TABLE "Order" ADD COLUMN "sandbox" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrderLine" ALTER COLUMN "reservationReference" DROP NOT NULL;
ALTER TABLE "OrderLine" ALTER COLUMN "reservedLocation" DROP NOT NULL;
ALTER TABLE "OrderLine" ADD CONSTRAINT "order_line_reservation_pair"
  CHECK (("reservationReference" IS NULL) = ("reservedLocation" IS NULL));

CREATE TABLE "SandboxPaymentAttempt" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "gatewaySequence" SERIAL NOT NULL,
  "terminal" VARCHAR(8) NOT NULL,
  "nonce" VARCHAR(32) NOT NULL,
  "requestTimestamp" VARCHAR(14) NOT NULL,
  "formFields" JSONB NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "status" "SandboxPaymentStatus" NOT NULL DEFAULT 'pending',
  "paidAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SandboxPaymentAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sandbox_attempt_fields" CHECK (
    "gatewaySequence" BETWEEN 1 AND 999999 AND
    "terminal" ~ '^[A-Za-z0-9]{8}$' AND
    "nonce" ~ '^[0-9A-F]{32}$' AND
    "requestTimestamp" ~ '^[0-9]{14}$' AND
    "amount" > 0 AND "currency" = 'EUR' AND
    (("status" = 'paid') = ("paidAt" IS NOT NULL))
  )
);
CREATE UNIQUE INDEX "SandboxPaymentAttempt_orderId_key" ON "SandboxPaymentAttempt"("orderId");
CREATE UNIQUE INDEX "SandboxPaymentAttempt_gatewaySequence_key" ON "SandboxPaymentAttempt"("gatewaySequence");
CREATE UNIQUE INDEX "SandboxPaymentAttempt_nonce_key" ON "SandboxPaymentAttempt"("nonce");
ALTER TABLE "SandboxPaymentAttempt" ADD CONSTRAINT "SandboxPaymentAttempt_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SandboxPaymentEvent" (
  "id" UUID NOT NULL,
  "attemptId" UUID NOT NULL,
  "eventHash" VARCHAR(64) NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SandboxPaymentEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SandboxPaymentEvent_attemptId_eventHash_key" ON "SandboxPaymentEvent"("attemptId", "eventHash");
ALTER TABLE "SandboxPaymentEvent" ADD CONSTRAINT "SandboxPaymentEvent_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "SandboxPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION protect_sandbox_checkout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'Order' THEN
    IF NEW."sandbox" IS DISTINCT FROM OLD."sandbox" THEN
      RAISE EXCEPTION 'order sandbox identity is immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'SandboxPaymentAttempt' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'sandbox payment attempts cannot be deleted';
    END IF;
    IF ROW(NEW.id, NEW."orderId", NEW."gatewaySequence", NEW.terminal, NEW.nonce,
           NEW."requestTimestamp", NEW."formFields", NEW.amount, NEW.currency, NEW."createdAt")
       IS DISTINCT FROM
       ROW(OLD.id, OLD."orderId", OLD."gatewaySequence", OLD.terminal, OLD.nonce,
           OLD."requestTimestamp", OLD."formFields", OLD.amount, OLD.currency, OLD."createdAt")
       OR (OLD.status = 'paid' AND ROW(NEW.status, NEW."paidAt") IS DISTINCT FROM ROW(OLD.status, OLD."paidAt")) THEN
      RAISE EXCEPTION 'sandbox payment identity and successful outcome are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "order_sandbox_immutability_guard"
  BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION protect_sandbox_checkout();
CREATE TRIGGER "sandbox_attempt_immutability_guard"
  BEFORE UPDATE OR DELETE ON "SandboxPaymentAttempt" FOR EACH ROW EXECUTE FUNCTION protect_sandbox_checkout();
CREATE TRIGGER "sandbox_payment_event_immutability_guard"
  BEFORE UPDATE OR DELETE ON "SandboxPaymentEvent" FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE FUNCTION validate_sandbox_order_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Order" o WHERE o.id = NEW."orderId"
      AND ((o."sandbox" AND NEW."reservationReference" IS NULL)
        OR (NOT o."sandbox" AND NEW."reservationReference" IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'order line reservation must match order environment';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "sandbox_order_line_guard"
  AFTER INSERT OR UPDATE ON "OrderLine" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_sandbox_order_line();

CREATE FUNCTION validate_sandbox_payment_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Order" o WHERE o.id = NEW."orderId" AND o."sandbox") THEN
    RAISE EXCEPTION 'sandbox payment attempt requires a sandbox order';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "sandbox_payment_order_guard"
  AFTER INSERT OR UPDATE ON "SandboxPaymentAttempt" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_sandbox_payment_order();
