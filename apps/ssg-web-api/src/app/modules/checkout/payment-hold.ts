import type { BankPaymentOutcome } from '../../../generated/prisma/enums';

export const PAYMENT_HOLD_DURATION_MS = 10 * 60 * 1000;

export function paymentHold(
  expiresAt: Date | null,
  expiredAt: Date | null,
  attempt: { outcome: BankPaymentOutcome } | null,
) {
  const state = attempt
    ? attempt.outcome === 'paid' ? 'payment_verified'
      : attempt.outcome === 'failed' ? 'payment_failed' : 'payment_pending'
    : expiresAt === null ? 'legacy'
      : expiredAt || expiresAt.getTime() <= Date.now() ? 'expired' : 'active';
  return { expiresAt: expiresAt?.toISOString() ?? null, state };
}
