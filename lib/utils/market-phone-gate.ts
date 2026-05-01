import type { User } from '@/types';
import { isValidPhoneNumber, normalizePhoneInput } from './phone';

/**
 * Logged-in users must have a contact phone on file (format-validated).
 * We do not require SMS/OTP verification — phone is for calls / coordination only.
 */
export function isMarketPhoneGateSatisfied(profile: User | null): boolean {
  const raw = String(profile?.phone ?? profile?.marketBuyerPhone ?? '').trim();
  const normalizedPhone = normalizePhoneInput(raw);
  return isValidPhoneNumber(normalizedPhone);
}
