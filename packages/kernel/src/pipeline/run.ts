import type { Evidence, Signal } from '../domain/evidence.js';
import type { Proposal } from '../domain/proposal.js';
import type { RawSession } from '../domain/session.js';
import type { PipelineContext } from './context.js';
import {
  KernelNotReadyError,
  type EvolutionPipeline,
  type PipelineRun,
  type StageRecord,
} from './pipeline.js';

const STAGE_NAMES = ['collect', 'distill', 'aggregate', 'propose', 'critique'] as const;

function missingStages(pipeline: Partial<EvolutionPipeline>): readonly string[] {
  return STAGE_NAMES.filter((name) => typeof pipeline[name] === 'undefined');
}

async function timed<T>(
  name: string,
  at: Date,
  work: () => Promise<T>,
  count: (value: T) => number,
): Promise<{ value: T; record: StageRecord }> {
  const startedAt = at.toISOString();
  const started = Date.now();
  const value = await work();
  const record: StageRecord = {
    name,
    startedAt,
    durationMs: Date.now() - started,
    itemCount: count(value),
  };
  return { value, record };
}

/**
 * Runs the five stages in order and returns the proposal plus an audit trail.
 *
 * This function never writes to a host surface: turning a proposal into files
 * is the caller's decision, done through `SurfaceStore` after review.
 */
export async function runEvolution(
  pipeline: Partial<EvolutionPipeline>,
  ctx: PipelineContext,
): Promise<PipelineRun> {
  const missing = missingStages(pipeline);
  if (missing.length > 0) {
    throw new KernelNotReadyError(
      `pipeline is incomplete, missing stage(s): ${missing.join(', ')}. ` +
        'M1 wires the real stages; see docs/roadmap.md.',
    );
  }

  const full = pipeline as EvolutionPipeline;
  const runStarted = ctx.clock.now();
  const stages: StageRecord[] = [];

  const collected = await timed<readonly RawSession[]>(
    'collect',
    runStarted,
    () => full.collect.run(undefined, ctx),
    (sessions) => sessions.length,
  );
  stages.push(collected.record);

  const distilled = await timed<readonly Evidence[]>(
    'distill',
    runStarted,
    () => full.distill.run(collected.value, ctx),
    (evidence) => evidence.length,
  );
  stages.push(distilled.record);

  const aggregated = await timed<readonly Signal[]>(
    'aggregate',
    runStarted,
    () => full.aggregate.run(distilled.value, ctx),
    (signals) => signals.length,
  );
  stages.push(aggregated.record);

  const proposed = await timed<Proposal>(
    'propose',
    runStarted,
    () => full.propose.run(aggregated.value, ctx),
    (proposal) => proposal.expressions.length,
  );
  stages.push(proposed.record);

  const critiqued = await timed<Proposal>(
    'critique',
    runStarted,
    () => full.critique.run(proposed.value, ctx),
    (proposal) => proposal.expressions.length,
  );
  stages.push(critiqued.record);

  return {
    id: ctx.ids.next('run'),
    startedAt: runStarted.toISOString(),
    stages,
    proposal: critiqued.value,
  };
}
