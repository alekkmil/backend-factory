import type { Locale, ProductType } from '../../../generated/prisma/enums';

export function productPath(slug: string, productType: ProductType, locale: Locale, ssgId: string): string {
  const prefix = productType === 'jewellery'
    ? (locale === 'bg' ? '/бижута' : '/en/jewelry')
    : (locale === 'bg' ? '/скъпоценни-камъни' : '/en/gemstones');
  return `${prefix}/${slug}-${ssgId}`;
}
