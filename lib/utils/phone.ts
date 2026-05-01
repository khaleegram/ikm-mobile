import { FALLBACK_PHONE_COUNTRY } from '@/lib/utils/phone-country';
import metadata from 'libphonenumber-js/metadata.min.json';
import { parsePhoneNumberFromString } from 'libphonenumber-js/core';

export function normalizePhoneInput(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  const parsed = parsePhoneNumberFromString(trimmed, metadata);
  if (parsed?.isValid()) {
    return parsed.format('E.164');
  }

  const plusCleaned = trimmed.replace(/[^\d+]/g, '');
  if (plusCleaned.startsWith('+')) {
    const again = parsePhoneNumberFromString(plusCleaned, metadata);
    if (again?.isValid()) {
      return again.format('E.164');
    }
    return `+${plusCleaned.slice(1).replace(/\D/g, '')}`;
  }

  const digits = plusCleaned.replace(/\D/g, '');
  const withDefault = parsePhoneNumberFromString(digits, FALLBACK_PHONE_COUNTRY, metadata);
  if (withDefault?.isValid()) {
    return withDefault.format('E.164');
  }

  return digits;
}

export function isValidPhoneNumber(value: string): boolean {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;

  if (parsePhoneNumberFromString(trimmed, metadata)?.isValid()) {
    return true;
  }

  const normalized = normalizePhoneInput(trimmed);
  if (!normalized) return false;
  if (normalized.startsWith('+')) return parsePhoneNumberFromString(normalized, metadata)?.isValid() ?? false;
  return parsePhoneNumberFromString(trimmed, FALLBACK_PHONE_COUNTRY, metadata)?.isValid() ?? false;
}

export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
