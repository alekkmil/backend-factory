import { Injectable } from '@nestjs/common';
import type {
  DeliveryScope,
  FulfilmentMethod,
  LocationCode,
  PriceVisibility,
  ProductType,
  PublicationStatus,
  SalesMode,
  StockStatus,
} from '../../../generated/prisma/enums';

type DecimalInput = string | { toString(): string } | null;

export interface CommercialUnitInput {
  id: string;
  status: StockStatus;
  locationCode: LocationCode;
  price: DecimalInput;
  currency: string | null;
  weightG: DecimalInput;
  stoneWeightCt: DecimalInput;
  dimensions: unknown;
}

export interface CommercialProductInput {
  publicationStatus: PublicationStatus;
  productType: ProductType;
  jewelleryTypeCode: string | null;
  salesMode: SalesMode;
  priceVisibility: PriceVisibility;
  fulfilmentMethods: FulfilmentMethod[];
  deliveryScope: DeliveryScope | null;
  deliveryLocalityIds: string[];
  pickupLocationCodes: LocationCode[];
}

export interface CommercialSettingsInput {
  ready: boolean;
  currency: string;
  allowedProductTypes: ProductType[];
  allowedJewelleryTypeCodes: string[];
  maxOnlinePrice: DecimalInput;
}

export type FulfilmentContext =
  | { method: 'delivery'; localityId: string }
  | { method: 'store_pickup'; locationCode: LocationCode }
  | null;

export interface FulfilmentOptions {
  methods: FulfilmentMethod[];
  pickup_location_codes: LocationCode[];
  delivery_scope: DeliveryScope | null;
  delivery_locality_ids: string[];
  selection_required: boolean;
}

export interface CommercialResult {
  is_visible: boolean;
  display_price: { amount: string; currency: string; is_from: boolean } | null;
  primary_action: 'buy' | 'enquiry' | 'catalogue_enquiry' | 'none';
  message_key: string;
  fulfilment_options: FulfilmentOptions;
  can_submit_order: boolean;
}

export interface PublicFacts {
  dimensions_mm: Record<string, string> | null;
  weight_g: string | null;
  stone_weight_ct: string | null;
}

export interface EvaluatedUnit {
  unit: CommercialUnitInput;
  price: { amount: string; currency: string };
  facts: PublicFacts;
  fulfilment_options: FulfilmentOptions;
}

export interface CatalogueFilterUnit {
  unitId: string;
  amount: string;
  currency: string;
  fulfilmentMethods: FulfilmentMethod[];
}

interface ParsedPrice {
  minorUnits: bigint;
  amount: string;
}

const EMPTY_FULFILMENT: FulfilmentOptions = {
  methods: [],
  pickup_location_codes: [],
  delivery_scope: null,
  delivery_locality_ids: [],
  selection_required: false,
};

const MONEY_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;
const MEASUREMENT_PATTERN = /^\d{1,9}(?:\.\d{1,3})?$/;
const DIMENSION_KEYS = [
  'length',
  'width',
  'height',
  'inner_diameter',
  'circumference',
] as const;

function decimalText(value: DecimalInput): string | null {
  if (value === null) {
    return null;
  }
  const text = value.toString();
  return text;
}

function parsePrice(value: DecimalInput): ParsedPrice | null {
  const text = decimalText(value);
  if (text === null || !MONEY_PATTERN.test(text)) {
    return null;
  }
  const [whole, fraction = ''] = text.split('.');
  const minorUnits = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minorUnits <= 0n) {
    return null;
  }
  return {
    minorUnits,
    amount: `${whole}.${fraction.padEnd(2, '0')}`,
  };
}

function parseMeasurement(value: DecimalInput): string | null {
  const text = decimalText(value);
  if (text === null || !MEASUREMENT_PATTERN.test(text)) {
    return null;
  }
  const [whole, fraction = ''] = text.split('.');
  if (BigInt(whole) === 0n && /^0*$/.test(fraction)) {
    return null;
  }
  return `${whole}.${fraction.padEnd(3, '0')}`;
}

function parseDimensions(value: unknown): Record<string, string> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const dimensions: Record<string, string> = {};
  for (const key of DIMENSION_KEYS) {
    const candidate = record[key];
    if (typeof candidate === 'string' && MEASUREMENT_PATTERN.test(candidate)) {
      const [whole, fraction = ''] = candidate.split('.');
      if (BigInt(whole) > 0n || /[1-9]/.test(fraction)) {
        dimensions[key] = `${whole}.${fraction.padEnd(3, '0')}`;
      }
    }
  }
  return Object.keys(dimensions).length > 0 ? dimensions : null;
}

function factsFor(unit: CommercialUnitInput): PublicFacts {
  return {
    dimensions_mm: parseDimensions(unit.dimensions),
    weight_g: parseMeasurement(unit.weightG),
    stone_weight_ct: parseMeasurement(unit.stoneWeightCt),
  };
}

function permittedProductType(
  product: CommercialProductInput,
  settings: CommercialSettingsInput,
): boolean {
  if (!settings.allowedProductTypes.includes(product.productType)) {
    return false;
  }
  return (
    product.productType !== 'jewellery' ||
    (product.jewelleryTypeCode !== null &&
      settings.allowedJewelleryTypeCodes.includes(product.jewelleryTypeCode))
  );
}

function unitFulfilment(
  product: CommercialProductInput,
  unit: CommercialUnitInput,
  context: FulfilmentContext,
): FulfilmentMethod[] {
  if (unit.status !== 'available') {
    return [];
  }

  const methods: FulfilmentMethod[] = [];
  if (
    product.fulfilmentMethods.includes('delivery') &&
    product.deliveryScope !== null &&
    (product.deliveryScope === 'bulgaria' ||
      product.deliveryLocalityIds.length > 0) &&
    (context === null ||
      (context.method === 'delivery' &&
        (product.deliveryScope === 'bulgaria' ||
          product.deliveryLocalityIds.includes(context.localityId))))
  ) {
    methods.push('delivery');
  }
  if (
    product.fulfilmentMethods.includes('store_pickup') &&
    product.pickupLocationCodes.includes(unit.locationCode) &&
    (context === null ||
      (context.method === 'store_pickup' &&
        context.locationCode === unit.locationCode))
  ) {
    methods.push('store_pickup');
  }
  return methods;
}

function optionsFor(
  product: CommercialProductInput,
  units: CommercialUnitInput[],
  context: FulfilmentContext,
  selectionRequired = context === null,
): FulfilmentOptions {
  const methods = new Set<FulfilmentMethod>();
  const pickupLocations = new Set<LocationCode>();
  for (const unit of units) {
    const unitMethods = unitFulfilment(product, unit, context);
    for (const method of unitMethods) {
      methods.add(method);
      if (method === 'store_pickup') {
        pickupLocations.add(unit.locationCode);
      }
    }
  }
  return {
    methods: [...methods],
    pickup_location_codes: [...pickupLocations],
    delivery_scope: methods.has('delivery') ? product.deliveryScope : null,
    delivery_locality_ids:
      methods.has('delivery') && product.deliveryScope === 'selected_localities'
        ? [...product.deliveryLocalityIds]
        : [],
    selection_required: selectionRequired && methods.size > 0,
  };
}

function displayedPrice(
  units: CommercialUnitInput[],
  settings: CommercialSettingsInput,
  fallbackUnits: CommercialUnitInput[],
): CommercialResult['display_price'] {
  const pool = units.length > 0 ? units : fallbackUnits;
  const prices = pool
    .map((unit) => parsePrice(unit.price))
    .filter((price): price is ParsedPrice => price !== null);
  if (prices.length === 0) {
    return null;
  }
  const min = prices.reduce((a, b) => (a.minorUnits < b.minorUnits ? a : b));
  const max = prices.reduce((a, b) => (a.minorUnits > b.minorUnits ? a : b));
  return {
    amount: min.amount,
    currency: settings.currency,
    is_from: min.minorUnits !== max.minorUnits,
  };
}

@Injectable()
export class CommercialEvaluator {
  evaluateProduct(
    product: CommercialProductInput,
    units: CommercialUnitInput[],
    settings: CommercialSettingsInput | null,
    context: FulfilmentContext = null,
  ): CommercialResult {
    if (product.publicationStatus !== 'published') {
      return {
        is_visible: false,
        display_price: null,
        primary_action: 'none',
        message_key: 'product.unavailable',
        fulfilment_options: EMPTY_FULFILMENT,
        can_submit_order: false,
      };
    }

    if (product.salesMode === 'archive_catalogue') {
      return {
        is_visible: true,
        display_price: null,
        primary_action: 'catalogue_enquiry',
        message_key: 'product.archive_enquiry',
        fulfilment_options: EMPTY_FULFILMENT,
        can_submit_order: false,
      };
    }

    const availableUnits = units.filter((unit) => unit.status === 'available');
    if (availableUnits.length === 0) {
      return this.enquiry('product.unavailable_for_purchase');
    }

    if (product.priceVisibility === 'hidden') {
      return this.enquiry('product.enquiry');
    }

    const validPricedUnits =
      settings === null ||
      !/^[A-Z]{3}$/.test(settings.currency)
        ? []
        : availableUnits.filter(
            (unit) =>
              unit.currency === settings.currency &&
              parsePrice(unit.price) !== null,
          );
    if (validPricedUnits.length === 0 || settings === null) {
      return this.enquiry('product.price_unavailable');
    }

    const validProductType = permittedProductType(product, settings);
    const underPriceLimit = validPricedUnits.filter((unit) => {
      const price = parsePrice(unit.price);
      const max = parsePrice(settings.maxOnlinePrice);
      return price !== null && (max === null || price.minorUnits <= max.minorUnits);
    });

    const potentiallyFulfillable = underPriceLimit.filter(
      (unit) => unitFulfilment(product, unit, null).length > 0,
    );
    const contextEligible = potentiallyFulfillable.filter(
      (unit) => unitFulfilment(product, unit, context).length > 0,
    );
    const options = optionsFor(
      product,
      potentiallyFulfillable,
      null,
      context === null,
    );
    const price = displayedPrice(
      contextEligible,
      settings,
      validPricedUnits,
    );

    if (product.salesMode === 'enquiry_only') {
      return this.enquiry('product.enquiry', price, options);
    }
    if (!settings.ready) {
      return this.enquiry(
        'product.configuration_unavailable',
        price,
        options,
      );
    }
    if (!validProductType) {
      return this.enquiry('product.not_available_online', price, options);
    }
    if (underPriceLimit.length === 0) {
      return this.enquiry('product.online_price_limit', price, options);
    }
    if (potentiallyFulfillable.length === 0) {
      return this.enquiry('product.fulfilment_unavailable', price, options);
    }

    return {
      is_visible: true,
      display_price: price,
      primary_action: 'buy',
      message_key: contextEligible.length > 0 || context === null
        ? 'product.buy'
        : 'product.fulfilment.select',
      fulfilment_options: options,
      can_submit_order:
        settings.ready && context !== null && contextEligible.length > 0,
    };
  }

  evaluateExactUnit(
    product: CommercialProductInput,
    unit: CommercialUnitInput,
    settings: CommercialSettingsInput | null,
    context: FulfilmentContext,
  ): EvaluatedUnit | null {
    if (
      settings === null ||
      !settings.ready ||
      product.publicationStatus !== 'published' ||
      product.salesMode !== 'direct_purchase' ||
      product.priceVisibility !== 'visible' ||
      !permittedProductType(product, settings) ||
      unit.status !== 'available'
    ) {
      return null;
    }
    const price = parsePrice(unit.price);
    const ceiling = parsePrice(settings.maxOnlinePrice);
    if (
      price === null ||
      unit.currency !== settings.currency ||
      (ceiling !== null && price.minorUnits > ceiling.minorUnits)
    ) {
      return null;
    }
    const methods = unitFulfilment(product, unit, context);
    if (methods.length === 0) {
      return null;
    }
    return {
      unit,
      price: { amount: price.amount, currency: settings.currency },
      facts: factsFor(unit),
      fulfilment_options: optionsFor(product, [unit], context),
    };
  }

  evaluateCatalogueFilterUnit(
    product: CommercialProductInput,
    unit: CommercialUnitInput,
    settings: CommercialSettingsInput | null,
    context: FulfilmentContext,
  ): CatalogueFilterUnit | null {
    if (
      settings === null ||
      product.publicationStatus !== 'published' ||
      product.salesMode === 'archive_catalogue' ||
      product.priceVisibility !== 'visible' ||
      unit.status !== 'available' ||
      !/^[A-Z]{3}$/.test(settings.currency)
    ) {
      return null;
    }
    const price = parsePrice(unit.price);
    if (price === null || unit.currency !== settings.currency) {
      return null;
    }
    const max = parsePrice(settings.maxOnlinePrice);
    return {
      unitId: unit.id,
      amount: price.amount,
      currency: settings.currency,
      fulfilmentMethods:
        max !== null && price.minorUnits > max.minorUnits
          ? []
          : unitFulfilment(product, unit, context),
    };
  }

  private enquiry(
    messageKey: string,
    price: CommercialResult['display_price'] = null,
    options: FulfilmentOptions = EMPTY_FULFILMENT,
  ): CommercialResult {
    return {
      is_visible: true,
      display_price: price,
      primary_action: 'enquiry',
      message_key: messageKey,
      fulfilment_options: options,
      can_submit_order: false,
    };
  }
}
