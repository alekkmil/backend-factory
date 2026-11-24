import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { Prisma } from '../../../generated/prisma/client';

const BASE_URL = 'https://ee.econt.com/services/Nomenclatures/NomenclaturesService';
const CITY_ID = /^[1-9]\d{0,8}$/;
const OFFICE_CODE = /^[A-Za-z0-9@._-]{1,80}$/;
type Language = 'bg' | 'en';
type LocationType = 'staffed_office' | 'drop_box' | 'unknown';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cityId(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && CITY_ID.test(String(value))
    ? String(value)
    : null;
}

function locationType(office: Record<string, unknown> | null): LocationType {
  if (office?.isMPS !== false || office.isDrive !== false) return 'unknown';
  if (office.isAPS === true) return 'drop_box';
  if (office.isAPS === false) return 'staffed_office';
  return 'unknown';
}

export function invalidEcontOffice(): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    message_key: 'errors.validation',
    details: { 'receiving.officeCode': 'office_unavailable' },
  });
}

@Injectable()
export class EcontDirectoryService {
  private readonly logger = new Logger(EcontDirectoryService.name);

  private unavailable(): ServiceUnavailableException {
    this.logger.warn('Econt directory is unavailable or returned invalid data');
    return new ServiceUnavailableException({
      code: 'TEMPORARY_UNAVAILABLE',
      message_key: 'errors.temporary_unavailable',
    });
  }

  private async request(method: 'getCities' | 'getOffices', data: Record<string, string>): Promise<unknown[]> {
    let response: unknown;
    try {
      const result = await axios.post<unknown>(`${BASE_URL}.${method}.json`, data, {
        timeout: 8000,
        maxRedirects: 0,
        maxContentLength: 8 * 1024 * 1024,
      });
      response = result.data;
    } catch {
      throw this.unavailable();
    }
    const body = record(response);
    const values = body?.[method === 'getCities' ? 'cities' : 'offices'];
    if (!Array.isArray(values)) throw this.unavailable();
    return values;
  }

  async localities(locale: Language, query?: string) {
    const values = await this.request('getCities', { countryCode: 'BGR' });
    const cities = values.map((value) => {
      const city = record(value);
      const id = cityId(city?.id);
      const name = text(locale === 'bg' ? city?.name : city?.nameEn);
      const postcode = text(city?.postCode);
      const country = record(city?.country);
      if (!id || !name || !postcode || country?.code3 !== 'BGR') throw this.unavailable();
      const region = text(locale === 'bg' ? city?.regionName : city?.regionNameEn);
      return { id, name, postcode, region };
    });
    const search = query?.trim().toLocaleLowerCase(locale);
    return search
      ? cities.filter((city) => [city.name, city.postcode, city.region]
          .some((value) => value?.toLocaleLowerCase(locale).includes(search)))
      : cities;
  }

  async offices(selectedCityId: string, locale: Language) {
    const values = await this.request('getOffices', { countryCode: 'BGR', cityID: selectedCityId });
    return values.map((value) => {
      const office = record(value);
      const address = record(office?.address);
      const city = record(address?.city);
      const country = record(city?.country);
      const id = cityId(office?.id);
      const code = text(office?.code);
      const actualCityId = cityId(city?.id);
      const name = text(locale === 'bg' ? office?.name : office?.nameEn);
      const fullAddress = text(locale === 'bg' ? address?.fullAddress : address?.fullAddressEn);
      const locality = text(locale === 'bg' ? city?.name : city?.nameEn);
      if (!id || !code || !OFFICE_CODE.test(code) || actualCityId !== selectedCityId ||
          country?.code3 !== 'BGR' || !name || !fullAddress || !locality) {
        throw this.unavailable();
      }
      return {
        id, code, name, address: fullAddress, locality, cityId: actualCityId,
        locationType: locationType(office),
      };
    });
  }

  async selectedOffice(selectedCityId: string, code: string, locale: Language) {
    const offices = await this.offices(selectedCityId, locale);
    const matches = offices.filter((office) => office.code === code);
    if (matches.length !== 1) throw invalidEcontOffice();
    return matches[0];
  }

  selectionFromSnapshot(value: Prisma.JsonValue): { cityId: string; officeCode: string } | null {
    const receiving = record(value);
    if (receiving?.method !== 'econt_office') return null;
    if (typeof receiving.cityId !== 'string' || !CITY_ID.test(receiving.cityId) ||
        typeof receiving.officeCode !== 'string' || !OFFICE_CODE.test(receiving.officeCode)) {
      throw invalidEcontOffice();
    }
    return { cityId: receiving.cityId, officeCode: receiving.officeCode };
  }
}
