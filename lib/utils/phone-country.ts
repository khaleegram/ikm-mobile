import metadata from 'libphonenumber-js/metadata.min.json';
import { getCountries, type CountryCode } from 'libphonenumber-js/core';

export const FALLBACK_PHONE_COUNTRY: CountryCode = 'NG';

export function resolveDefaultPhoneCountryIso2(): CountryCode {
  // Product requirement: default phone country is always Nigeria.
  if (getCountries(metadata).includes(FALLBACK_PHONE_COUNTRY)) return FALLBACK_PHONE_COUNTRY;
  return FALLBACK_PHONE_COUNTRY;
}
