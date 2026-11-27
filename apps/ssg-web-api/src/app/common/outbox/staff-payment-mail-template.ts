import type { CapturedMail } from './local-mail-capture.service';

export interface StaffPaymentMailInput {
  recipient: string;
  orderNumber: string;
  receivingLabel: string;
  paymentDate: string;
  paymentTime: string;
  itemsTotal: string;
  deliveryFee: string;
  paidTotal: string;
  manualReview: boolean;
  currentProductData: boolean;
  items: {
    name: string;
    barcodes: string[];
    ssgId: string;
    quantity: number;
    unitPrice: string;
    productUrl: string | null;
  }[];
  buyerName: string;
  buyerPhone: string;
  buyerEmail: string;
  receivingLines: string[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

export function renderStaffPaymentMail(input: StaffPaymentMailInput): CapturedMail {
  const review = input.manualReview ? 'Проверете плащането преди предаване или изпращане.' : '';
  const currentWarning = input.currentProductData
    ? 'Внимание: част от данните за бижутата са текущи или не са налични на български и може да се различават от данните при поръчката.'
    : '';
  const missingUrl = input.items.some((item) => !item.productUrl)
    ? 'Внимание: няма налична българска връзка за някои бижута.'
    : '';
  const summary = [
    `Поръчка № ${input.orderNumber}`,
    `Плащането е потвърдено на ${input.paymentDate} в ${input.paymentTime} ч.`,
    `Стойност на бижутата: ${input.itemsTotal}`,
    `Доставка / получаване: ${input.deliveryFee}`,
    `Общо платено: ${input.paidTotal}`,
  ];
  const phoneLink = `tel:${encodeURIComponent(input.buyerPhone).replace(/%2B/g, '+')}`;
  const emailLink = `mailto:${encodeURIComponent(input.buyerEmail)}`;
  const itemsText = input.items.map((item) => [
    item.name,
    `Баркод: ${item.barcodes.join(', ')}`,
    `SSG код: ${item.ssgId}`,
    `Количество: ${item.quantity}`,
    `Единична цена: ${item.unitPrice}`,
    ...(item.productUrl ? [`Виж бижуто: ${item.productUrl}`] : []),
  ].join('\n')).join('\n\n');
  const text = [
    ...(review ? [review, ''] : []),
    ...summary, '', ...(currentWarning ? [currentWarning, ''] : []),
    ...(missingUrl ? [missingUrl, ''] : []),
    'Поръчани бижута', itemsText, '',
    'Клиент',
    `Име: ${input.buyerName}`,
    `Телефон: ${input.buyerPhone} · Обади се: ${phoneLink}`,
    `Имейл: ${input.buyerEmail} · Пиши на клиента: ${emailLink}`,
    '', ...input.receivingLines,
  ].join('\n');
  const itemsHtml = input.items.map((item) => `<div style="margin:0 0 20px"><p style="margin:0 0 6px"><strong>${escapeHtml(item.name)}</strong></p><p style="margin:3px 0">Баркод: ${escapeHtml(item.barcodes.join(', '))}</p><p style="margin:3px 0">SSG код: ${escapeHtml(item.ssgId)}</p><p style="margin:3px 0">Количество: ${item.quantity}</p><p style="margin:3px 0">Единична цена: ${escapeHtml(item.unitPrice)}</p>${item.productUrl ? `<p style="margin:6px 0"><a href="${escapeHtml(item.productUrl)}" style="color:#60482f;text-decoration:underline">Виж бижуто</a></p>` : ''}</div>`).join('');
  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f0e8;color:#28241f;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55"><div style="padding:24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;margin:0 auto;background:#fbfaf7"><tr><td style="padding:24px">${review ? `<p style="color:#8b2f24;font-weight:bold">${escapeHtml(review)}</p>` : ''}${summary.map((line, index) => index === 0 ? `<h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(line)}</h1>` : `<p style="margin:6px 0">${escapeHtml(line)}</p>`).join('')}${currentWarning ? `<p style="color:#8b2f24">${escapeHtml(currentWarning)}</p>` : ''}${missingUrl ? `<p style="color:#8b2f24">${escapeHtml(missingUrl)}</p>` : ''}<h2 style="font-size:18px;margin:24px 0 12px">Поръчани бижута</h2>${itemsHtml}<h2 style="font-size:18px;margin:24px 0 12px">Клиент</h2><p style="margin:4px 0">Име: ${escapeHtml(input.buyerName)}</p><p style="margin:4px 0">Телефон: ${escapeHtml(input.buyerPhone)} · <a href="${escapeHtml(phoneLink)}" style="color:#60482f;text-decoration:underline">Обади се</a></p><p style="margin:4px 0">Имейл: ${escapeHtml(input.buyerEmail)} · <a href="${escapeHtml(emailLink)}" style="color:#60482f;text-decoration:underline">Пиши на клиента</a></p><div style="margin:24px 0 0">${input.receivingLines.map((line) => `<p style="margin:6px 0">${escapeHtml(line)}</p>`).join('')}</div></td></tr></table></div></body></html>`;
  return {
    recipient: input.recipient,
    subject: `Платена поръчка № ${input.orderNumber} · ${input.receivingLabel} · ${input.paidTotal}`,
    text,
    html,
  };
}
