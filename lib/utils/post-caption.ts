/** Caption text only — strips inline #hashtags from description. */
export function formatPostCaption(description?: string | null): string {
  return String(description || '')
    .replace(/#[\w\u0590-\u05ff]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
