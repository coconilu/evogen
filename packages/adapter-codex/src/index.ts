import { codexHome, defaultProjectRoot, defaultSessionsRoot } from './paths.js';
import { CodexSessionSource } from './sessions.js';
import { CodexSurfaceStore } from './surfaces.js';

export { codexHome, defaultProjectRoot, defaultSessionsRoot } from './paths.js';
export { CodexSessionSource, type CodexSessionSourceOptions } from './sessions.js';
export { CodexSurfaceStore, type CodexSurfaceStoreOptions, changeMarker } from './surfaces.js';

export interface CodexAdapterOptions {
  readonly projectRoot?: string;
  readonly sessionsRoot?: string;
  readonly codexHome?: string;
  readonly sessionLimit?: number;
}

/**
 * Wires one host runtime together. Everything the kernel needs comes out of
 * here as ports; the kernel itself never imports this package.
 */
export function createCodexAdapter(options: CodexAdapterOptions = {}) {
  const home = options.codexHome ?? codexHome();
  const projectRoot = options.projectRoot ?? defaultProjectRoot();
  const sessionsRoot = options.sessionsRoot ?? defaultSessionsRoot();
  return {
    host: 'codex' as const,
    home,
    projectRoot,
    sessionsRoot,
    sessions: new CodexSessionSource({ root: sessionsRoot, limit: options.sessionLimit }),
    surfaces: new CodexSurfaceStore({ projectRoot, codexHome: home }),
  };
}

export type CodexAdapter = ReturnType<typeof createCodexAdapter>;
