import {
  createEvolutionPipeline,
  createMemoryStore,
  runEvolution,
  sequentialIds,
  systemClock,
  type ModelClient,
  type ModelResponse,
  type PipelineContext,
  type Proposal,
  type PipelineRun,
  type SurfaceStore,
  type SessionSource,
} from '@evogen/kernel';
import type { ProposalStore } from '@evogen/kernel';
import { ChatCompletionsClient, resolveModelConfig } from './config/model.js';
import { FileProposalStore } from './store/file-proposal-store.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StageEvent {
  readonly name: string;
  readonly itemCount: number;
  readonly durationMs: number;
}

export interface RunResult {
  readonly run: PipelineRun;
  readonly proposal: Proposal | undefined;
  readonly usage: Usage;
  readonly surfacesUnchanged: boolean;
}

export interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RunnerHosts {
  readonly sessions: SessionSource;
  readonly surfaces: SurfaceStore;
}

export interface RunnerOptions {
  readonly sessionLimit: number;
  readonly store?: ProposalStore;
  readonly onStage?: (event: StageEvent) => void;
}

export const DEFAULT_STORE_PATH = join(homedir(), '.evogen', 'store.json');

/** Runs the read-only pipeline against the given hosts, tracking usage and integrity. */
export async function runPipeline(
  hosts: RunnerHosts,
  options: RunnerOptions,
): Promise<RunResult> {
  const config = await resolveModelConfig(process.cwd());
  if (!config) {
    throw new MissingModelConfigError();
  }

  const store = options.store ?? createMemoryStore();
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const model: ModelClient = {
    complete: async (request): Promise<ModelResponse> => {
      const response = await new ChatCompletionsClient(config).complete(request);
      calls += 1;
      inputTokens += response.usage?.inputTokens ?? 0;
      outputTokens += response.usage?.outputTokens ?? 0;
      return response;
    },
  };

  const base = createEvolutionPipeline({ collect: { sessionLimit: options.sessionLimit } });
  const pipeline = withStageEvents(base, options.onStage);

  const ctx: PipelineContext = {
    sessions: hosts.sessions,
    surfaces: hosts.surfaces,
    store,
    model,
    clock: systemClock(),
    ids: sequentialIds(),
  };

  const specs = await hosts.surfaces.list();
  const before = await digestsOf(hosts.surfaces, specs);
  const run = await runEvolution(pipeline, ctx);
  const after = await digestsOf(hosts.surfaces, specs);
  const surfacesUnchanged = specs.every((spec) => before.get(spec.id) === after.get(spec.id));

  return {
    run,
    proposal: run.proposal,
    usage: { calls, inputTokens, outputTokens },
    surfacesUnchanged,
  };
}

export class MissingModelConfigError extends Error {
  constructor() {
    super(
      'model endpoint is not configured: set EVOGEN_MODEL_BASE_URL, EVOGEN_MODEL_API_KEY and ' +
        'EVOGEN_MODEL_ID (process env or .env.local; see .env.example)',
    );
    this.name = 'MissingModelConfigError';
  }
}

export async function resolveModelConfigOrThrow(): Promise<void> {
  const config = await resolveModelConfig(process.cwd());
  if (!config) throw new MissingModelConfigError();
}

async function digestsOf(
  surfaces: SurfaceStore,
  specs: Awaited<ReturnType<SurfaceStore['list']>>,
): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  for (const spec of specs) {
    digests.set(spec.id, spec.exists ? await surfaces.digest(spec) : '');
  }
  return digests;
}

/** Wraps each stage so callers can observe progress as stages complete. */
function withStageEvents(
  pipeline: ReturnType<typeof createEvolutionPipeline>,
  onStage: ((event: StageEvent) => void) | undefined,
): ReturnType<typeof createEvolutionPipeline> {
  if (!onStage) return pipeline;
  const wrap = <I, O>(stage: { name: string; run(input: I, ctx: PipelineContext): Promise<O> }) => ({
    name: stage.name,
    run: async (input: I, ctx: PipelineContext): Promise<O> => {
      const started = Date.now();
      const output = await stage.run(input, ctx);
      onStage({ name: stage.name, itemCount: countOf(stage.name, output), durationMs: Date.now() - started });
      return output;
    },
  });
  return {
    collect: wrap(pipeline.collect),
    distill: wrap(pipeline.distill),
    aggregate: wrap(pipeline.aggregate),
    propose: wrap(pipeline.propose),
    critique: wrap(pipeline.critique),
  };
}

function countOf(stageName: string, output: unknown): number {
  if (stageName === 'propose' || stageName === 'critique') {
    return (output as Proposal).expressions.length;
  }
  return (output as readonly unknown[]).length;
}

export function openStore(path = DEFAULT_STORE_PATH): ProposalStore {
  return new FileProposalStore(path);
}
