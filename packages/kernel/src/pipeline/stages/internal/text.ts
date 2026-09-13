/**
 * Text helpers shared by the stages. Deliberately language-agnostic:
 * similarity uses character shingles so CJK and latin text behave alike.
 */

/** Lowercase, drop punctuation and collapse all whitespace. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function shingles(text: string, size = 2): Set<string> {
  const flat = text.replace(/\s+/g, '');
  const set = new Set<string>();
  if (flat.length <= size) {
    if (flat.length > 0) set.add(flat);
    return set;
  }
  for (let i = 0; i <= flat.length - size; i += 1) {
    set.add(flat.slice(i, i + size));
  }
  return set;
}

/** Jaccard similarity over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const left = shingles(normalizeText(a));
  const right = shingles(normalizeText(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const item of left) {
    if (right.has(item)) shared += 1;
  }
  return shared / (left.size + right.size - shared);
}

/** True when `needle` appears in `haystack` after normalization. */
export function containsNormalized(haystack: string, needle: string): boolean {
  const n = normalizeText(needle);
  if (n.length === 0) return false;
  return normalizeText(haystack).includes(n);
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
