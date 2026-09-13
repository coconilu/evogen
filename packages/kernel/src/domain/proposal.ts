import type { Signal } from './evidence.js';
import type { SurfaceOp } from './surface.js';

export interface ExpressionPayload {
  readonly content: string;
  /** Required by `replace`: the exact text to substitute. */
  readonly before?: string;
}

/** One concrete edit to one surface. A proposal is a set of these. */
export interface Expression {
  readonly id: string;
  readonly surfaceId: string;
  readonly op: SurfaceOp;
  readonly payload: ExpressionPayload;
  readonly rationale: string;
  readonly evidenceIds: readonly string[];
}

export interface Critique {
  /** 0..1, higher = riskier. */
  readonly risk: number;
  /** 0..1, higher = more certain the edit is an improvement. */
  readonly confidence: number;
  readonly notes: string;
}

export type ProposalStatus = 'draft' | 'approved' | 'rejected' | 'applied' | 'partially_applied';

export interface Proposal {
  readonly id: string;
  readonly createdAt: string;
  readonly title: string;
  readonly status: ProposalStatus;
  readonly signals: readonly Signal[];
  readonly expressions: readonly Expression[];
  readonly critique?: Critique;
}
