import { isEmail } from 'class-validator';
import {
  EnquiryException,
  EnquiryFieldErrorCode,
} from './enquiry-exception';
import { EnquiryKind, TunnelId } from './dto/submit-enquiry.dto';

export type EnquiryFields = Record<string, string | string[]>;

const fieldNames: Record<EnquiryKind, readonly string[]> = {
  [EnquiryKind.Contact]: [
    'contactName',
    'company',
    'email',
    'subject',
    'message',
  ],
  [EnquiryKind.Ferry]: [
    'ferryLine',
    'departureDate',
    'registrationNumbers',
    'driverName',
    'cargoTypes',
    'contactName',
    'company',
    'email',
    'additionalInformation',
  ],
  [EnquiryKind.Tunnel]: [
    'tunnelId',
    'contactName',
    'company',
    'email',
    'travelDate',
    'vehicleDetails',
    'message',
  ],
};

const requiredFields: Record<EnquiryKind, readonly string[]> = {
  [EnquiryKind.Contact]: ['contactName', 'company', 'email'],
  [EnquiryKind.Ferry]: [
    'ferryLine',
    'departureDate',
    'registrationNumbers',
    'driverName',
    'cargoTypes',
    'contactName',
    'company',
    'email',
  ],
  [EnquiryKind.Tunnel]: ['tunnelId', 'contactName', 'company', 'email'],
};

const stringLimits: Partial<Record<EnquiryKind, Record<string, number>>> = {
  [EnquiryKind.Contact]: {
    contactName: 200,
    company: 250,
    email: 254,
    subject: 200,
    message: 5000,
  },
  [EnquiryKind.Ferry]: {
    ferryLine: 500,
    departureDate: 10,
    registrationNumbers: 100,
    driverName: 200,
    contactName: 200,
    company: 250,
    email: 254,
    additionalInformation: 5000,
  },
  [EnquiryKind.Tunnel]: {
    contactName: 200,
    company: 250,
    email: 254,
    travelDate: 10,
    vehicleDetails: 1000,
    message: 5000,
  },
};

const validCargoTypes = new Set(['refrigerated', 'normal', 'adr']);
const validTunnelIds = new Set<string>(Object.values(TunnelId));

export function normalizeEnquiryFields(
  kind: EnquiryKind,
  input: Record<string, unknown>,
): EnquiryFields {
  const errors: Record<string, EnquiryFieldErrorCode[]> = {};
  const normalized: EnquiryFields = {};
  const allowedFields = fieldNames[kind];

  for (const field of Object.keys(input)) {
    if (!allowedFields.includes(field)) {
      addError(errors, field, 'invalid_choice');
    }
  }

  for (const field of requiredFields[kind]) {
    if (
      input[field] === undefined ||
      input[field] === null ||
      (typeof input[field] === 'string' && input[field].trim().length === 0)
    ) {
      addError(errors, field, 'required');
    }
  }

  for (const [field, maxLength] of Object.entries(
    stringLimits[kind] ?? {},
  )) {
    const value = input[field];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== 'string') {
      addError(errors, field, 'invalid_choice');
      continue;
    }

    const trimmedValue = value.trim();
    if (trimmedValue.length > maxLength) {
      addError(errors, field, 'too_long');
      continue;
    }

    if (trimmedValue.length === 0) {
      if (field === 'departureDate' || field === 'travelDate') {
        continue;
      }
      if (requiredFields[kind].includes(field)) {
        continue;
      }
    }

    if (field === 'email' && trimmedValue.length > 0 && !isEmail(trimmedValue)) {
      addError(errors, field, 'invalid_email');
      continue;
    }
    if (
      (field === 'departureDate' || field === 'travelDate') &&
      trimmedValue.length > 0 &&
      !isCalendarDate(trimmedValue)
    ) {
      addError(errors, field, 'invalid_date');
      continue;
    }
    if (
      field !== 'departureDate' &&
      field !== 'travelDate' &&
      trimmedValue.length > 0
    ) {
      normalized[field] =
        field === 'email' ? trimmedValue.toLowerCase() : trimmedValue;
    } else if (field === 'departureDate' && trimmedValue.length > 0) {
      normalized[field] = trimmedValue;
    } else if (field === 'travelDate' && trimmedValue.length > 0) {
      normalized[field] = trimmedValue;
    }
  }

  if (kind === EnquiryKind.Ferry) {
    const cargoTypes = input.cargoTypes;
    if (cargoTypes !== undefined && cargoTypes !== null) {
      if (
        !Array.isArray(cargoTypes) ||
        cargoTypes.length < 1 ||
        cargoTypes.length > 3 ||
        !cargoTypes.every(
          (item: unknown): item is string =>
            typeof item === 'string' && validCargoTypes.has(item),
        ) ||
        new Set(cargoTypes).size !== cargoTypes.length
      ) {
        addError(errors, 'cargoTypes', 'invalid_choice');
      } else {
        normalized.cargoTypes = [...cargoTypes];
      }
    }
  }

  if (kind === EnquiryKind.Tunnel) {
    const tunnelId = input.tunnelId;
    if (tunnelId !== undefined && tunnelId !== null) {
      if (typeof tunnelId !== 'string' || !validTunnelIds.has(tunnelId)) {
        addError(errors, 'tunnelId', 'invalid_choice');
      } else {
        normalized.tunnelId = tunnelId;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new EnquiryException(
      422,
      'validation_failed',
      errors,
    );
  }

  return normalized;
}

export function isEnquiryFields(value: unknown): value is EnquiryFields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (field) =>
      typeof field === 'string' ||
      (Array.isArray(field) &&
        field.every((item: unknown) => typeof item === 'string')),
  );
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addError(
  errors: Record<string, EnquiryFieldErrorCode[]>,
  field: string,
  code: EnquiryFieldErrorCode,
): void {
  const fieldErrors = errors[field] ?? [];
  if (!fieldErrors.includes(code)) {
    fieldErrors.push(code);
  }
  errors[field] = fieldErrors;
}
