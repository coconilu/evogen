/**
 * Models sometimes wrap JSON in prose or code fences even in json mode.
 * This extracts the first balanced JSON value; returns undefined otherwise.
 */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '```');
  for (let start = cleaned.indexOf('{'); start !== -1; start = cleaned.indexOf('{', start + 1)) {
    const parsed = tryParseBalanced(cleaned, start, '{', '}');
    if (parsed.ok) return parsed.value;
  }
  for (let start = cleaned.indexOf('['); start !== -1; start = cleaned.indexOf('[', start + 1)) {
    const parsed = tryParseBalanced(cleaned, start, '[', ']');
    if (parsed.ok) return parsed.value;
  }
  return undefined;
}

function tryParseBalanced(
  text: string,
  start: number,
  open: string,
  close: string,
): { ok: true; value: unknown } | { ok: false } {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return { ok: true, value: JSON.parse(text.slice(start, i + 1)) as unknown };
        } catch {
          return { ok: false };
        }
      }
    }
  }
  return { ok: false };
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN;
}
