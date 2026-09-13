import type { ExpressionPayload } from './proposal.js';
import type { SurfaceOp } from './surface.js';

/** A planned write: `before`/`after` are computed without touching disk. */
export interface ApplyStep {
  readonly changeId: string;
  readonly expressionId: string;
  readonly surfaceId: string;
  readonly path: string;
  readonly op: SurfaceOp;
  readonly payload: ExpressionPayload;
  readonly before: string;
  readonly after: string;
  readonly appliedAt: string;
}

/** Proof of a write: enough to verify it, and to undo it later. */
export interface ChangeRecord {
  readonly changeId: string;
  readonly proposalId?: string;
  readonly expressionId: string;
  readonly surfaceId: string;
  readonly path: string;
  readonly op: SurfaceOp;
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly appliedAt: string;
}

export interface ApplyFailure {
  readonly expressionId: string;
  readonly reason: string;
}

export interface ApplyOutcome {
  readonly applied: readonly ChangeRecord[];
  readonly failed: readonly ApplyFailure[];
}
