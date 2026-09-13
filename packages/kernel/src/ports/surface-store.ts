import type { ApplyStep, ChangeRecord } from '../domain/change.js';
import type { ExpressionPayload } from '../domain/proposal.js';
import type { SurfaceOp, SurfaceSpec } from '../domain/surface.js';

export interface PlanInput {
  readonly surface: SurfaceSpec;
  readonly op: SurfaceOp;
  readonly payload: ExpressionPayload;
  readonly changeId: string;
  readonly expressionId: string;
  readonly at: Date;
}

/**
 * How a host's instruction files are discovered, read and written.
 * `plan` must be pure: it returns the exact text that `apply` would write.
 */
export interface SurfaceStore {
  list(): Promise<readonly SurfaceSpec[]>;
  read(surface: SurfaceSpec): Promise<string>;
  digest(surface: SurfaceSpec): Promise<string>;
  plan(input: PlanInput): Promise<ApplyStep>;
  apply(step: ApplyStep): Promise<ChangeRecord>;
  /** Undo a previous `apply`. Only `append`-style changes are revertible. */
  revert(change: ChangeRecord): Promise<void>;
}
