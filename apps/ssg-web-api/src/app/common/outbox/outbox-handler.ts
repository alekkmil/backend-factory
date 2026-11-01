import type { ClaimedOutboxMessage } from './outbox.service';
import type { CapturedMail } from './local-mail-capture.service';

export class OutboxDispatchError extends Error {
  constructor(readonly safeCode: string) {
    super(safeCode);
  }
}

export type OutboxDispatchResult =
  | { outcome: 'sent'; providerMessageId?: string }
  | { outcome: 'suppressed'; safeError: string };

export interface OutboxJobHandler {
  dispatch(message: ClaimedOutboxMessage): Promise<OutboxDispatchResult>;
}

export function renderMail(
  recipient: string,
  subject: string,
  fields: readonly (readonly [string, string])[],
): CapturedMail {
  return {
    recipient,
    subject,
    text: fields.map(([label, value]) => `${label}: ${value}`).join('\n'),
    html: fields.map(([label, value]) =>
      `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value).replace(/\n/g, '<br>')}</p>`,
    ).join(''),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}
