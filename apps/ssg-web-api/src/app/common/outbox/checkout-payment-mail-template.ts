import type { Locale } from '../../../generated/prisma/enums';
import { trustedImageUrl } from './mail-image-url';

interface PaymentMailInput {
  locale: Locale;
  orderNumber: string;
  date: string;
  items: { title: string; price: string; imageUrl?: string }[];
  total: string;
  receiving: string;
  receivingInstructions: string;
  openingHours: string;
  storeEmail: string;
  storePhone: string;
  accessUrl: string;
  mediaOrigin: URL | null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function paragraphs(value: string): string {
  return escapeHtml(value).replace(/\r\n?|\n/g, '<br>');
}

export function renderCheckoutPaymentHtml(input: PaymentMailInput): string {
  const bg = input.locale === 'bg';
  const copy = bg
    ? {
        title: 'Благодарим ви за поръчката',
        intro: 'Получихме плащането за вашата поръчка.',
        order: 'Поръчка', date: 'Дата на поръчката', items: 'Вашите бижута',
        total: 'Платена сума', delivery: 'Доставка / получаване',
        receiving: 'Получаване', hours: 'Работно време', button: 'Виж поръчката',
        questions: 'Въпроси?',
      }
    : {
        title: 'Thank you for your order',
        intro: 'We have received payment for your order.',
        order: 'Order', date: 'Order date', items: 'Your jewellery',
        total: 'Amount paid', delivery: 'Delivery / collection',
        receiving: 'Receiving', hours: 'Opening hours', button: 'View order',
        questions: 'Questions?',
      };
  const items = input.items.map((item) => {
    const imageUrl = trustedImageUrl(item.imageUrl, input.mediaOrigin);
    const image = imageUrl && !new URL(imageUrl).search && !new URL(imageUrl).hash
      ? `<td width="112" valign="top" style="padding:0 16px 16px 0"><img src="${escapeHtml(imageUrl)}" width="112" alt="${escapeHtml(item.title)}" style="display:block;width:112px;max-width:100%;height:auto;border:0"></td>`
      : '';
    return `<tr>${image}<td colspan="${image ? 1 : 2}" valign="top" style="padding:0 0 16px"><p style="margin:0 0 8px;font-size:16px;line-height:1.45;color:#28241f">${escapeHtml(item.title)}</p><p style="margin:0;color:#755b3e;font-weight:bold">${escapeHtml(item.price)}</p></td></tr>`;
  }).join('');
  return `<!doctype html><html lang="${input.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(copy.title)}</title><style>@media only screen and (max-width:600px){.mail-shell{padding:12px!important}.mail-card{padding:20px!important}}</style></head><body style="margin:0;background:#f4f0e8;color:#28241f;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55"><div class="mail-shell" style="padding:24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;margin:0 auto;background:#fbfaf7"><tr><td class="mail-card" style="padding:32px"><div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:4px;color:#755b3e;margin:0 0 20px" aria-label="SSG">SSG</div><h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:28px;line-height:1.25;margin:0 0 12px;color:#28241f">${escapeHtml(copy.title)}</h1><p style="margin:0 0 20px;color:#625b50">${escapeHtml(copy.intro)}</p><p style="margin:0 0 4px"><strong>${escapeHtml(copy.order)}:</strong> ${escapeHtml(input.orderNumber)}</p><p style="margin:0 0 24px;color:#625b50"><strong>${escapeHtml(copy.date)}:</strong> ${escapeHtml(input.date)}</p><h2 style="font-size:18px;margin:0 0 16px;padding-top:20px;border-top:1px solid #e4ded2">${escapeHtml(copy.items)}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${items}</table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #e4ded2;border-bottom:1px solid #e4ded2"><tr><td style="padding:12px 0 4px">${escapeHtml(copy.delivery)}</td><td align="right" style="padding:12px 0 4px">${bg ? '0,00 €' : '€0.00'}</td></tr><tr><td style="padding:4px 0 12px"><strong>${escapeHtml(copy.total)}</strong></td><td align="right" style="padding:4px 0 12px"><strong>${escapeHtml(input.total)}</strong></td></tr></table><h2 style="font-size:18px;margin:24px 0 8px">${escapeHtml(copy.receiving)}</h2><p style="margin:0 0 12px">${paragraphs(input.receiving)}</p><p style="margin:0 0 12px">${paragraphs(input.receivingInstructions)}</p><p style="margin:0 0 24px"><strong>${escapeHtml(copy.hours)}:</strong> ${paragraphs(input.openingHours)}</p><p style="margin:0 0 24px"><a href="${escapeHtml(input.accessUrl)}" style="display:inline-block;background:#755b3e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:4px;font-weight:bold">${escapeHtml(copy.button)}</a></p><p style="margin:0;padding-top:16px;border-top:1px solid #e4ded2;color:#625b50;font-size:14px">${escapeHtml(copy.questions)} ${escapeHtml(input.storeEmail)} · ${escapeHtml(input.storePhone)}<br>SSG · Sea of Silver &amp; Gold</p></td></tr></table></div></body></html>`;
}
