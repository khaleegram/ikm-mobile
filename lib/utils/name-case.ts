export function toNameCase(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const first = part.charAt(0).toUpperCase();
      const rest = part.slice(1).toLowerCase();
      return `${first}${rest}`;
    })
    .join(' ');
}
