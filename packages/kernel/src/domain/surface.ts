/**
 * A surface is a file the host agent reads on every run: its instructions,
 * long-term memory, or one of its skills. The kernel only knows this shape —
 * never which host it belongs to, and never how the file is written.
 */
export type SurfaceKind = 'instructions' | 'memory' | 'skill';

/** Operations a surface can accept. `append` is the safe default. */
export type SurfaceOp = 'append' | 'replace' | 'create';

export interface SurfaceSpec {
  /** Stable id inside one host runtime, e.g. `agents.project`. */
  readonly id: string;
  readonly kind: SurfaceKind;
  /** Absolute path in the host runtime. */
  readonly path: string;
  readonly supportedOps: readonly SurfaceOp[];
  readonly exists: boolean;
}
