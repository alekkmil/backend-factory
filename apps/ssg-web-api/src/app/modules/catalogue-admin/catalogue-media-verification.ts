import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { MediaStorageService } from '../../common/media-storage.service';
import { hashIdempotencyPayload } from '../../common/transactions/transaction.service';
import { readDerivative } from '../products/product-read.service';

export const MEDIA_SELECT = {
  orderBy: { sortOrder: 'asc' },
  select: { assetId: true, sortOrder: true, assetIdRelation: { select: { derivatives: true } } },
} satisfies Prisma.RevisionImageFindManyArgs;

type SelectedImage = Prisma.RevisionImageGetPayload<typeof MEDIA_SELECT>;

export async function verifyCatalogueMedia(
  storage: MediaStorageService,
  productId: string,
  images: SelectedImage[],
): Promise<string> {
  const derivatives = images.flatMap((image) => {
    const value = image.assetIdRelation.derivatives;
    if (!Array.isArray(value) || value.length !== 4) {
      throw new ConflictException({ code: 'MEDIA_NOT_READY', message_key: 'errors.media_not_ready' });
    }
    let entries: ReturnType<typeof readDerivative>[];
    try {
      entries = value.map((entry) => readDerivative(entry));
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      throw new ConflictException({ code: 'MEDIA_NOT_READY', message_key: 'errors.media_not_ready' });
    }
    if (new Set(entries.map((entry) => entry.size)).size !== 4) {
      throw new ConflictException({ code: 'MEDIA_NOT_READY', message_key: 'errors.media_not_ready' });
    }
    return entries;
  });
  await storage.verifyImages(`products/${productId}/`, derivatives);
  return hashIdempotencyPayload(images);
}
