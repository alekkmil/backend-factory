import type { Locale } from '../../../generated/prisma/enums';
import type { CapturedMail } from './local-mail-capture.service';

export type EnquiryMailKind =
  | 'general'
  | 'consultation'
  | 'bespoke'
  | 'assessment'
  | 'documents'
  | 'gemstone'
  | 'maintenance'
  | 'jewellery';

export interface EnquiryMailContext {
  kind: 'service' | 'regarding' | 'jewellery';
  name: string;
  url: string;
  imageUrl?: string;
  codes?: string[];
}

export interface EnquiryMailInput {
  recipient: string;
  locale: Locale;
  kind: EnquiryMailKind;
  receivedAt: Date;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  context: EnquiryMailContext | null;
  sourcePage: { label: string; url: string } | null;
  frontendOrigin: URL;
  mediaOrigin: URL | null;
}

const COPY: Record<Locale, Record<EnquiryMailKind, string>> = {
  bg: {
    general: 'Общо запитване',
    consultation: 'Лична консултация',
    bespoke: 'Бижу по поръчка',
    assessment: 'Експертна оценка',
    documents: 'Сертификати и документи',
    gemstone: 'Избор на скъпоценен камък',
    maintenance: 'Корекция и поддръжка',
    jewellery: 'Запитване за бижуто',
  },
  en: {
    general: 'General enquiry',
    consultation: 'Personal consultation',
    bespoke: 'Bespoke jewellery',
    assessment: 'Expert assessment',
    documents: 'Certificates and documents',
    gemstone: 'Choosing a gemstone',
    maintenance: 'Resizing and maintenance',
    jewellery: 'Enquiry about this piece',
  },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function text(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function absoluteUrl(origin: URL, path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  const resolved = new URL(path, origin);
  return resolved.origin === origin.origin ? resolved.toString() : null;
}

function receivedDate(value: Date, locale: Locale): string {
  const parts = new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
    timeZone: 'Europe/Sofia',
    day: '2-digit',
    month: locale === 'bg' ? '2-digit' : 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return locale === 'bg'
    ? `${part('day')}.${part('month')}.${part('year')}, ${part('hour')}:${part('minute')} ч. (София)`
    : `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')} (Sofia)`;
}

function actionButton(label: string, href: string): string {
  return `<a class="mail-action" href="${escapeHtml(href)}" style="display:inline-block;background:#755b3e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:4px;margin:4px 8px 4px 0;font-size:16px">${escapeHtml(label)}</a>`;
}

function trustedImageUrl(
  value: string | undefined,
  origin: URL | null,
): string | null {
  if (!value || !origin) return null;
  try {
    const url = new URL(value);
    if (
      url.origin !== origin.origin ||
      !url.pathname.startsWith(origin.pathname) ||
      url.username ||
      url.password
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function renderEnquiryMail(input: EnquiryMailInput): CapturedMail {
  const bg = input.locale === 'bg';
  const title = COPY[input.locale][input.kind];
  const origin = input.frontendOrigin;
  const contextUrl = input.context
    ? absoluteUrl(origin, input.context.url)
    : null;
  const sourceUrl = input.sourcePage
    ? absoluteUrl(origin, input.sourcePage.url)
    : null;
  const context = input.context && contextUrl ? input.context : null;
  const imageUrl = trustedImageUrl(context?.imageUrl, input.mediaOrigin);
  const date = receivedDate(input.receivedAt, input.locale);
  const labels = bg
    ? {
        received: 'Получено',
        details: 'Данни за клиента',
        name: 'Име',
        email: 'Имейл',
        phone: 'Телефон',
        service: 'Услуга',
        regarding: 'Относно',
        jewellery: 'Бижу',
        code: 'Код',
        view: 'Виж бижуто',
        viewPage: 'Отвори страницата',
        message: 'Съобщение',
        reply: 'Отговор по имейл',
        call: 'Обаждане',
        source: 'Изпратено от',
        home: 'Начална страница',
        page: 'Страница на сайта',
        footer: 'Автоматично известие от сайта SSG.',
      }
    : {
        received: 'Received',
        details: 'Customer details',
        name: 'Name',
        email: 'Email',
        phone: 'Phone',
        service: 'Service',
        regarding: 'Regarding',
        jewellery: 'Jewellery',
        code: 'Code',
        view: 'View jewellery',
        viewPage: 'Open page',
        message: 'Message',
        reply: 'Reply by email',
        call: 'Call',
        source: 'Sent from',
        home: 'Home',
        page: 'Website page',
        footer: 'Automated notification from the SSG website.',
      };
  const contextLabel =
    context?.kind === 'service'
      ? labels.service
      : context?.kind === 'regarding'
        ? labels.regarding
        : labels.jewellery;
  const message = text(input.message);
  const image = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" width="160" height="160" alt="${escapeHtml(context?.name ?? '')}" style="display:block;width:160px;height:160px;max-width:100%;object-fit:contain;margin:0 0 12px">`
    : '';
  const codes = context?.codes?.length
    ? `<p style="margin:8px 0"><strong>${labels.code}:</strong> ${context.codes.map(escapeHtml).join(', ')}</p>`
    : '';
  const contextHtml = context
    ? `<section style="margin:20px 0;padding:16px;background:#fff;border-left:3px solid #b39263">${image}<p style="margin:0 0 8px"><strong>${labels[context.kind]}:</strong> <a href="${escapeHtml(contextUrl ?? '')}" style="color:#60482f">${escapeHtml(context.name)}</a></p>${codes}<p style="margin:8px 0"><a href="${escapeHtml(contextUrl ?? '')}" style="color:#60482f">${context.kind === 'jewellery' ? labels.view : labels.viewPage}</a></p></section>`
    : '';
  const sourceLabel = input.sourcePage?.label.trim() || labels.page;
  const sourceHtml = sourceUrl
    ? `<p style="margin:20px 0 8px;color:#625b50;font-size:14px">${labels.source}: <a href="${escapeHtml(sourceUrl)}" style="color:#60482f">${escapeHtml(sourceLabel)}</a></p>`
    : '';
  const buttons = [
    input.email
      ? actionButton(labels.reply, `mailto:${encodeURIComponent(input.email)}`)
      : '',
    input.phone
      ? actionButton(labels.call, `tel:${encodeURIComponent(input.phone)}`)
      : '',
  ]
    .filter(Boolean)
    .join('');
  const messageHtml = message
    ? `<section style="margin:20px 0"><h2 style="font-size:18px;margin:0 0 8px">${labels.message}</h2><div style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(message)}</div></section>`
    : '';
  const header = `<div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;letter-spacing:3px;color:#755b3e;margin:0 0 16px" role="img" aria-label="SSG">SSG</div><h1 style="font-size:24px;line-height:1.3;margin:0 0 12px;color:#28241f">${escapeHtml(title)}</h1>`;
  const details = `<section style="margin:20px 0"><h2 style="font-size:18px;margin:0 0 8px">${labels.details}</h2><p style="margin:6px 0"><strong>${labels.name}:</strong> ${escapeHtml(input.name)}</p><p style="margin:6px 0"><strong>${labels.email}:</strong> <a href="mailto:${encodeURIComponent(input.email)}" style="color:#60482f">${escapeHtml(input.email)}</a></p>${input.phone ? `<p style="margin:6px 0"><strong>${labels.phone}:</strong> <a href="tel:${encodeURIComponent(input.phone)}" style="color:#60482f">${escapeHtml(input.phone)}</a></p>` : ''}</section>`;
  const html = `<!doctype html><html lang="${input.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>@media only screen and (max-width:600px){.mail-card{padding:16px!important}.mail-shell{padding:16px!important}.mail-action{display:block!important;width:max-content;max-width:100%;margin:8px 0!important}}</style></head><body style="margin:0;background:#f4f0e8;color:#28241f;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55"><div class="mail-shell" style="padding:24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;margin:0 auto;background:#fbfaf7"><tr><td class="mail-card" style="padding:24px">${header}<p style="margin:0;color:#625b50">${labels.received}: ${escapeHtml(date)}</p>${details}${contextHtml}${messageHtml}<div style="margin:20px 0">${buttons}</div>${sourceHtml}<p style="margin:20px 0 0;padding-top:14px;border-top:1px solid #e4ded2;color:#746c60;font-size:13px">${labels.footer}</p></td></tr></table></div></body></html>`;
  const lines = [
    'SSG',
    title,
    `${labels.received}: ${date}`,
    '',
    labels.details,
    `${labels.name}: ${input.name}`,
    `${labels.email}: ${input.email}`,
    ...(input.phone ? [`${labels.phone}: ${input.phone}`] : []),
    ...(context
      ? [
          '',
          `${contextLabel}: ${context.name}`,
          ...(context.codes?.length
            ? [`${labels.code}: ${context.codes.join(', ')}`]
            : []),
          contextUrl ?? '',
          ...(imageUrl ? [imageUrl] : []),
        ]
      : []),
    ...(message ? ['', labels.message, message] : []),
    '',
    ...(input.email ? [`${labels.reply}: mailto:${input.email}`] : []),
    ...(input.phone ? [`${labels.call}: tel:${input.phone}`] : []),
    ...(sourceUrl ? ['', `${labels.source}: ${sourceLabel}`, sourceUrl] : []),
    '',
    labels.footer,
  ];
  return {
    recipient: input.recipient,
    subject: `SSG web · ${title}`,
    fromName: bg ? 'SSG — Известия' : 'SSG — Notifications',
    replyTo: input.email,
    text: lines.join('\n'),
    html,
  };
}
