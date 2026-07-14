function trimDecimal(n: number): string {
  const fixed = n.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

/** Compact engagement counts: 0, 42, 1.2k, 3.4M */
export function formatCompactCount(value: number | null | undefined): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const v = Math.max(0, Math.trunc(n));
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${trimDecimal(v / 1000)}k`;
  return `${trimDecimal(v / 1_000_000)}M`;
}
