ALTER TABLE "Order"
  ADD COLUMN "paymentHoldExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "paymentHoldExpiredAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "Order_payment_hold_expiry_check"
    CHECK ("paymentHoldExpiredAt" IS NULL OR
      ("paymentHoldExpiresAt" IS NOT NULL AND "paymentHoldExpiredAt" >= "paymentHoldExpiresAt"));

CREATE INDEX "Order_paymentHoldExpiresAt_id_idx"
  ON "Order" ("paymentHoldExpiresAt", id);

CREATE FUNCTION enforce_bank_attempt_hold_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  hold_deadline TIMESTAMPTZ;
  hold_expired TIMESTAMPTZ;
BEGIN
  SELECT "paymentHoldExpiresAt", "paymentHoldExpiredAt"
    INTO hold_deadline, hold_expired
    FROM "Order" WHERE id = NEW."orderId" FOR UPDATE;
  IF hold_expired IS NOT NULL OR
    (hold_deadline IS NOT NULL AND hold_deadline <= clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = 'PHD01', MESSAGE = 'payment hold has expired';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "bank_payment_deadline_guard"
  BEFORE INSERT ON "BankPaymentAttempt"
  FOR EACH ROW EXECUTE FUNCTION enforce_bank_attempt_hold_deadline();
