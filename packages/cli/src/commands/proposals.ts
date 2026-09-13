import { createCodexAdapter } from '@evogen/adapter-codex';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MissingModelConfigError, openStore, runPipeline } from '../pipeline-runner.js';
import { buildPreviews, type ExpressionPreview } from '../previews.js';

export interface ProposalsArgs {
  readonly json: boolean;
  readonly projectRoot?: string;
  readonly sessionsRoot?: string;
  readonly limit: number;
  readonly save: boolean;
}

const HARD_SESSION_CAP = 200;
const STORE_PATH = join(homedir(), '.evogen', 'store.json');

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function runProposals(args: ProposalsArgs): Promise<number> {
  const adapter = createCodexAdapter({
    ...(args.projectRoot ? { projectRoot: args.projectRoot } : {}),
    ...(args.sessionsRoot ? { sessionsRoot: args.sessionsRoot } : {}),
  });

  let result;
  try {
    result = await runPipeline(adapter, {
      sessionLimit: Math.min(Math.max(1, args.limit), HARD_SESSION_CAP),
      ...(args.save ? { store: openStore(STORE_PATH) } : {}),
    });
  } catch (error) {
    if (error instanceof MissingModelConfigError) {
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
    throw error;
  }

  const { run, proposal, usage, surfacesUnchanged } = result;
  const previews: ExpressionPreview[] = await buildPreviews(adapter.surfaces, proposal);

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          run,
          proposal,
          previews,
          integrity: { surfacesUnchanged },
          usage,
          ...(args.save ? { savedTo: STORE_PATH } : {}),
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
    `integrity  surfaces ${surfacesUnchanged ? 'unchanged ✓ (nothing was written)' : 'CHANGED ✗ — this is a bug'}`,
  );
  lines.push(
    `usage      ${usage.calls} call(s) · in ${usage.inputTokens} · out ${usage.outputTokens} tokens`,
  );
  if (args.save) lines.push(`saved      ${STORE_PATH}`);
  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}
