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
} from '@evogen/kernel';
import { createCodexAdapter } from '@evogen/adapter-codex';
import { renderDiff } from '../diff.js';
import { ChatCompletionsClient, resolveModelConfig } from '../config/model.js';
import { FileProposalStore } from '../store/file-proposal-store.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ProposalsArgs {
  readonly json: boolean;
  readonly projectRoot?: string;
  readonly sessionsRoot?: string;
  readonly limit: number;
  readonly save: boolean;
}

const HARD_SESSION_CAP = 200;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function trackingModel(client: ModelClient): { model: ModelClient; usage: Usage } {
  const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const model: ModelClient = {
    complete: async (request): Promise<ModelResponse> => {
      const response = await client.complete(request);
      usage.calls += 1;
      usage.inputTokens += response.usage?.inputTokens ?? 0;
      usage.outputTokens += response.usage?.outputTokens ?? 0;
      return response;
    },
  };
  return { model, usage };
}

interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

interface ExpressionPreview {
  readonly expressionId: string;
  readonly surfaceId: string;
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly diff: string;
}

export async function runProposals(args: ProposalsArgs): Promise<number> {
  const config = await resolveModelConfig(process.cwd());
  if (!config) {
    process.stderr.write(
      [
        'evogen proposals needs a model endpoint.',
        '',
        'Set these (process env or a .env.local file in the working directory):',
        '  EVOGEN_MODEL_BASE_URL   root of a chat-completions compatible endpoint',
        '  EVOGEN_MODEL_API_KEY    key for that endpoint',
        '  EVOGEN_MODEL_ID         model id to call',
        '',
        'See .env.example in the repository root.',
        '',
      ].join('\n'),
    );
    return 2;
  }

  const adapter = createCodexAdapter({
    ...(args.projectRoot ? { projectRoot: args.projectRoot } : {}),
    ...(args.sessionsRoot ? { sessionsRoot: args.sessionsRoot } : {}),
  });
  const { model, usage } = trackingModel(new ChatCompletionsClient(config));
  const store = args.save
    ? new FileProposalStore(join(homedir(), '.evogen', 'store.json'))
    : createMemoryStore();
  const ctx: PipelineContext = {
    sessions: adapter.sessions,
    surfaces: adapter.surfaces,
    store,
    model,
    clock: systemClock(),
    ids: sequentialIds(),
  };

  const specs = await adapter.surfaces.list();
  const digestBefore = new Map<string, string>();
  for (const spec of specs) {
    digestBefore.set(spec.id, spec.exists ? await adapter.surfaces.digest(spec) : '');
  }

  const pipeline = createEvolutionPipeline({
    collect: { sessionLimit: Math.min(Math.max(1, args.limit), HARD_SESSION_CAP) },
  });
  const run = await runEvolution(pipeline, ctx);
  const proposal: Proposal | undefined = run.proposal;

  const digestAfter = new Map<string, string>();
  for (const spec of specs) {
    digestAfter.set(spec.id, spec.exists ? await adapter.surfaces.digest(spec) : '');
  }
  const unchanged = specs.every((spec) => digestBefore.get(spec.id) === digestAfter.get(spec.id));

  const previews: ExpressionPreview[] = [];
  if (proposal) {
    for (const expression of proposal.expressions) {
      const spec = specs.find((item) => item.id === expression.surfaceId);
      if (!spec) continue;
      const step = await adapter.surfaces.plan({
        surface: spec,
        op: expression.op,
        payload: expression.payload,
        changeId: 'preview',
        expressionId: expression.id,
        at: new Date(),
      });
      previews.push({
        expressionId: expression.id,
        surfaceId: expression.surfaceId,
        path: spec.path,
        before: step.before,
        after: step.after,
        diff: renderDiff(step.before, step.after),
      });
    }
  }

  if (args.save && proposal) await store.saveProposal(proposal);

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          run,
          proposal,
          previews,
          integrity: { surfacesUnchanged: unchanged },
          usage,
          ...(args.save ? { savedTo: join(homedir(), '.evogen', 'store.json') } : {}),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const lines: string[] = [];
  lines.push('evogen proposals');
  lines.push('');
  lines.push(`run           ${run.id}`);
  lines.push(`sessions      ${run.stages[0]?.itemCount ?? 0}`);
  lines.push(`model         ${config.modelId}`);
  lines.push(`project root  ${adapter.projectRoot}`);
  lines.push('');
  lines.push('stages');
  for (const stage of run.stages) {
    lines.push(`  ${stage.name.padEnd(10)} ${String(stage.itemCount).padStart(4)} items  ${String(stage.durationMs).padStart(7)} ms`);
  }
  lines.push('');

  const signals = proposal?.signals ?? [];
  lines.push(`signals (${signals.length})`);
  for (const signal of signals.slice(0, 12)) {
    lines.push(`  [${signal.kind}] ×${signal.weight} session(s)  ${signal.statement}`);
    lines.push(`      evidence: ${signal.evidenceIds.length} item(s)`);
  }
  if (signals.length > 12) lines.push(`  … ${signals.length - 12} more signals`);
  lines.push('');

  if (!proposal || proposal.expressions.length === 0) {
    lines.push('proposal: none — no suggestion survived distill/propose for these sessions.');
  } else {
    lines.push(`proposal  ${proposal.id}`);
    lines.push(`title     ${proposal.title}`);
    if (proposal.critique) {
      lines.push(
        `critique  risk ${proposal.critique.risk.toFixed(2)} · confidence ${proposal.critique.confidence.toFixed(2)}`,
      );
      lines.push(`          ${proposal.critique.notes}`);
    }
    lines.push('');
    for (const expression of proposal.expressions) {
      const preview = previews.find((item) => item.expressionId === expression.id);
      lines.push(`  [${expression.id}] ${expression.surfaceId} · ${expression.op}`);
      if (preview) lines.push(`  path      ${preview.path}`);
      if (expression.rationale.length > 0) lines.push(`  why       ${truncate(expression.rationale, 300)}`);
      lines.push('  content:');
      for (const line of expression.payload.content.split('\n')) lines.push(`    ${line}`);
      if (preview && preview.diff.length > 0) {
        lines.push('  diff:');
        for (const line of preview.diff.split('\n')) lines.push(`    ${line}`);
      }
      lines.push('');
    }
  }

  lines.push(
    `integrity  surfaces ${unchanged ? 'unchanged ✓ (nothing was written)' : 'CHANGED ✗ — this is a bug'}`,
  );
  lines.push(
    `usage      ${usage.calls} call(s) · in ${usage.inputTokens} · out ${usage.outputTokens} tokens`,
  );
  if (args.save) lines.push(`saved      ${join(homedir(), '.evogen', 'store.json')}`);
  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}
