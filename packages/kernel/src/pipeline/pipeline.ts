import type { Evidence, Signal } from '../domain/evidence.js';
import type { Proposal } from '../domain/proposal.js';
import type { RawSession } from '../domain/session.js';
import type { PipelineContext } from './context.js';

export interface Stage<I, O> {
  readonly name: string;
  run(input: I, ctx: PipelineContext): Promise<O>;
}

/** The five canonical steps. Each one is independent of any host. */
export interface EvolutionPipeline {
  readonly collect: Stage<void, readonly RawSession[]>;
  readonly distill: Stage<readonly RawSession[], readonly Evidence[]>;
  readonly aggregate: Stage<readonly Evidence[], readonly Signal[]>;
  readonly propose: Stage<readonly Signal[], Proposal>;
  readonly critique: Stage<Proposal, Proposal>;
}

/** Per-stage audit trail: which stage ran, on how much, for how long. */
export interface StageRecord {
  readonly name: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly itemCount: number;
}

export interface PipelineRun {
  readonly id: string;
  readonly startedAt: string;
  readonly stages: readonly StageRecord[];
  readonly proposal: Proposal | undefined;
}

export class KernelNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelNotReadyError';
  }
}
