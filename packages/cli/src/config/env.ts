import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Minimal `.env.local` loader. Process environment always wins over the file,
 * so a shell-exported key can never be silently overridden.
 */
export async function loadDotEnvLocal(cwd: string): Promise<Record<string, string>> {
  const file = join(cwd, '.env.local');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '');
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      // unquoted values may carry an inline comment: KEY=value # note
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    if (key.length > 0) values[key] = value;
  }
  return values;
}
