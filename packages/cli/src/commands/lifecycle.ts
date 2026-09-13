import { createCodexAdapter } from '@evogen/adapter-codex';
import type { Proposal, ProposalStatus } from '@evogen/kernel';
import { sequentialIds, systemClock } from '@evogen/kernel';
import { applyProposal, revertChange } from '../apply.js';
import { DEFAULT_STORE_PATH, openStore } from '../pipeline-runner.js';

export interface LifecycleArgs {
  readonly id: string;
  readonly projectRoot?: string;
  readonly sessionsRoot?: string;
  /** Overrides the default store location (~/.evogen/store.json). */
  readonly storePath?: string;
}

function store(args: LifecycleArgs) {
  return openStore(args.storePath ?? DEFAULT_STORE_PATH);
}

function loadProposal(args: LifecycleArgs): Promise<Proposal | undefined> {
  return store(args).getProposal(args.id);
}

async function setStatus(
  args: LifecycleArgs,
  from: ProposalStatus,
  to: ProposalStatus,
  label: string,
): Promise<number> {
  const proposalStore = store(args);
  const proposal = await loadProposal(args);
  if (!proposal) {
    process.stderr.write(
      `unknown proposal: ${args.id}\nRun \`evogen proposals --save\` or a studio run first.\n`,
    );
    return 1;
  }
  if (proposal.status !== from) {
    process.stderr.write(
      `proposal ${args.id} has status "${proposal.status}", expected "${from}" — nothing done.\n`,
    );
    return 1;
  }
  await proposalStore.saveProposal({ ...proposal, status: to });
  process.stdout.write(`${label} proposal ${args.id}\n`);
  return 0;
}

export async function runApprove(args: LifecycleArgs): Promise<number> {
  return setStatus(args, 'draft', 'approved', 'approved');
}

export async function runReject(args: LifecycleArgs): Promise<number> {
  return setStatus(args, 'draft', 'rejected', 'rejected');
}

export async function runApply(args: LifecycleArgs): Promise<number> {
  const adapter = createCodexAdapter({
    ...(args.projectRoot ? { projectRoot: args.projectRoot } : {}),
    ...(args.sessionsRoot ? { sessionsRoot: args.sessionsRoot } : {}),
  });
  const proposal = await loadProposal(args);
  if (!proposal) {
    process.stderr.write(`unknown proposal: ${args.id}\n`);
    return 1;
  }
  const report = await applyProposal(adapter.surfaces, store(args), sequentialIds(), systemClock(), proposal);

  for (const record of report.records) {
    process.stdout.write(
      `applied  ${record.changeId}  ${record.surfaceId} · ${record.op} → ${record.path}\n` +
        `         digest ${record.beforeDigest} → ${record.afterDigest}\n`,
    );
  }
  for (const failure of report.failures) {
    process.stderr.write(`failed   ${failure.expressionId}: ${failure.reason}\n`);
  }
  process.stdout.write(`status   ${report.proposal.status}\n`);
  if (report.records.length > 0) {
    process.stdout.write('revert   with `evogen changes` then `evogen revert <change-id>`\n');
  }
  return report.failures.length > 0 && report.records.length === 0 ? 1 : 0;
}

export async function runChanges(args: LifecycleArgs): Promise<number> {
  const proposalStore = store(args);
  const changes = await proposalStore.listChanges();
  if (changes.length === 0) {
    process.stdout.write('no changes recorded.\n');
    return 0;
  }
  for (const change of changes) {
    const reverted = (await proposalStore.isChangeReverted(change.changeId)) ? ' [reverted]' : '';
    process.stdout.write(
      `${change.changeId}${reverted}  ${change.surfaceId} · ${change.op}  ${change.path}\n` +
        `  applied ${change.appliedAt}  digest ${change.beforeDigest} → ${change.afterDigest}\n`,
    );
  }
  return 0;
}

export async function runRevert(args: LifecycleArgs): Promise<number> {
  const adapter = createCodexAdapter({
    ...(args.projectRoot ? { projectRoot: args.projectRoot } : {}),
    ...(args.sessionsRoot ? { sessionsRoot: args.sessionsRoot } : {}),
  });
  try {
    await revertChange(adapter.surfaces, store(args), args.id);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  process.stdout.write(`reverted ${args.id} — the marked block was removed exactly.\n`);
  return 0;
}
