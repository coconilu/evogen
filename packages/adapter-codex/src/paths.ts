import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where the host keeps its state. Overridable so tests never touch a real home. */
export function codexHome(): string {
  const fromEnv = process.env['CODEX_HOME'];
  return fromEnv && fromEnv.trim() !== '' ? fromEnv : join(homedir(), '.codex');
}

/** Session logs live under a dated tree below this root. */
export function defaultSessionsRoot(): string {
  return join(codexHome(), 'sessions');
}

/** The project whose instruction files we may edit. */
export function defaultProjectRoot(): string {
  return process.cwd();
}
