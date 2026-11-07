import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TransactionService } from '../transactions/transaction.service';
import type { StockFactHook } from './stock-fact.service';

@Injectable()
export class StockImpactService implements StockFactHook {
  constructor(private readonly transactions: TransactionService) {}

  async apply(
    tx: Prisma.TransactionClient,
    input: {
      stockItemId: string;
      priorReservationReference: string | null;
      factEventId: string;
    },
  ): Promise<void> {
    const lines = await tx.orderLine.findMany({
      where: {
        stockItemId: input.stockItemId,
        OR: [
          ...(input.priorReservationReference
            ? [{ reservationReference: input.priorReservationReference }]
            : []),
          { from_AcceptanceLine_orderLineId: { is: { accepted: true } } },
        ],
      },
      select: { id: true, orderId: true },
    });
    const ids = [...new Set(lines.map((line) => line.orderId))].sort();
    await this.transactions.lockOrders(tx, ids);
    if (!ids.length) return;
    await tx.storeCheck.updateMany({
      where: { lineId: { in: lines.map((line) => line.id) } },
      data: {
        status: 'unavailable',
        checkedAt: new Date(),
        note: `Unavailable after factual stock event ${input.factEventId}`,
      },
    });
    for (const id of ids) {
      const order = await tx.order.findUniqueOrThrow({ where: { id } });
      const code =
        order.status === 'confirmed'
          ? 'accepted_stock_conflict'
          : 'stock_conflict';
      await tx.order.update({
        where: { id },
        data: {
          attentionCodes: [...new Set([...order.attentionCodes, code])],
          version: { increment: 1 },
        },
      });
      // Never rewrite acceptance history or mark already-sent notifications as failed.
      await tx.outboxMessage.updateMany({
        where: {
          orderId: id,
          kind: 'customer_order_confirmed',
          status: { in: ['pending', 'failed'] },
          leaseOwner: null,
        },
        data: { status: 'suppressed', lastError: 'ACCEPTED_STOCK_CONFLICT' },
      });
    }
  }
}
