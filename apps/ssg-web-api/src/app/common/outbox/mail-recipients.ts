import { isEmail } from 'class-validator';

export function parseMailRecipients(value: unknown): string[] {
  if (typeof value !== 'string') throw new Error('MAIL_TO must contain valid email addresses');
  if (!value.trim()) return [];
  const recipients = value.split(',').map((recipient) => recipient.trim());
  if (recipients.some((recipient) => !isEmail(recipient) || /[\r\n]/.test(recipient))) {
    throw new Error('MAIL_TO must contain valid comma-separated email addresses');
  }
  return [...new Map(recipients.map((recipient) => [recipient.toLowerCase(), recipient])).values()];
}
