export function normalizePhoneInput(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  const cleaned = trimmed.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    return `+${cleaned.slice(1).replace(/\D/g, '')}`;
  }

  return cleaned.replace(/\D/g, '');
}

export function isValidPhoneNumber(value: string): boolean {
  const normalized = normalizePhoneInput(value);
  const digitsOnly = normalized.replace(/\D/g, '');
  return digitsOnly.length >= 10 && digitsOnly.length <= 15;
}

export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
