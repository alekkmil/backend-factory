import { BadRequestException } from '@nestjs/common';
import type {
  FulfilmentMethod,
  LocationCode,
} from '../../../generated/prisma/enums';
import type { FulfilmentContext } from '../../common/commercial/commercial-evaluator';

interface FulfilmentQuery {
  fulfilment_method?: FulfilmentMethod;
  locality_id?: string;
  pickup_location_code?: LocationCode;
}

export function fulfilmentContext(
  query: FulfilmentQuery,
): FulfilmentContext {
  const hasControlCharacters = (value: string): boolean =>
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    });

  if (query.locality_id && hasControlCharacters(query.locality_id)) {
    throw new BadRequestException();
  }
  if (!query.fulfilment_method) {
    if (query.locality_id || query.pickup_location_code) {
      throw new BadRequestException();
    }
    return null;
  }
  if (query.fulfilment_method === 'delivery') {
    if (query.pickup_location_code) {
      throw new BadRequestException();
    }
    return query.locality_id
      ? { method: 'delivery', localityId: query.locality_id }
      : null;
  }
  if (query.locality_id) {
    throw new BadRequestException();
  }
  return query.pickup_location_code
    ? {
        method: 'store_pickup',
        locationCode: query.pickup_location_code,
      }
    : null;
}
