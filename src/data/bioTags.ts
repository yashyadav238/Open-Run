export const MAX_BIO_LENGTH = 280;
export const MAX_BIO_TAGS = 8;
export const MAX_BIO_TAG_LENGTH = 32;

export const OPTIONAL_BIO_TAGS: string[] = [
  'Morning Runner',
  'Night Runner',
  '5K / 10K',
  'Half Marathoner',
  'Marathoner',
  'Trail & Parks',
  'Pace Buddy Wanted',
  'Social / Fun Runs',
  'Run Art Creator',
  'Conversational Pace',
  'Tempo & Speedwork',
  'Beginner Friendly',
  'Weekend Long Runs',
  'Sunrise Strider',
  'Walk-Run Mix',
  'Coffee After',
];

export function sanitizeBioTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const item of tags) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, MAX_BIO_TAG_LENGTH);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(trimmed);
    if (clean.length >= MAX_BIO_TAGS) break;
  }
  return clean;
}
