import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexAdapter } from '@evogen/adapter-codex';
import {
  type Expression,
  type Proposal,
  type Signal,
  type SurfaceStore,
  sequentialIds,
  systemClock,
} from '@evogen/kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyProposal, revertChange } from '../src/apply.js';
import { FileProposalStore } from '../src/store/file-proposal-store.js';

let root: string;
let storePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'evogen-apply-'));
  storePath = join(root, 'store.json');
});

function makeProposal(overrides?: {
  readonly status?: Proposal['status'];
  readonly extraExpressions?: readonly Expression[];
}): Proposal {
  const signal: Signal = {
    id: 'sig_1_000000',
    kind: 'preference',
    statement: 's',
    evidenceIds: ['ev_1_000000'],
    weight: 1,
  };
  const expression: Expression = {
    id: 'exp_1_000000',
    surfaceId: 'agents.project',
    op: 'append',
    payload: { content: '新规则：写操作前先确认。' },
    rationale: 'r',
    evidenceIds: ['ev_1_000000'],
  };
  return {
    id: 'prop_1_000000',
    createdAt: '2026-09-13T00:00:00.000Z',
    title: 't',
    status: overrides?.status ?? 'approved',
    signals: [signal],
    expressions: [expression, ...(overrides?.extraExpressions ?? [])],
  };
}

async function store() {
  const store = new FileProposalStore(storePath);
  await store.saveProposal(makeProposal());
  return store;
}

describe('applyProposal / revertChange (real adapter on temp files)', () => {
  it('enforces the two-phase rule: only approved proposals may be applied', async () => {
    const adapter = createCodexAdapter({ projectRoot: root, codexHome: root, sessionsRoot: root });
    const fileStore = await store();
    await fileStore.saveProposal(makeProposal({ status: 'draft' }));
    const proposal = (await fileStore.getProposal('prop_1_000000'))!;
    await expect(
      applyProposal(adapter.surfaces, fileStore, sequentialIds(), systemClock(), proposal),
    ).rejects.toThrow(/not approved/);
  });

  it('applies approved expressions into a marked block and records changes', async () => {
    const file = join(root, 'AGENTS.md');
    await writeFile(file, 'existing rule\n', 'utf8');
    const adapter = createCodexAdapter({ projectRoot: root, codexHome: root, sessionsRoot: root });
    const fileStore = await store();
    const proposal = (await fileStore.getProposal('prop_1_000000'))!;

    const report = await applyProposal(adapter.surfaces, fileStore, sequentialIds(), systemClock(), proposal);
    expect(report.failures).toEqual([]);
    expect(report.proposal.status).toBe('applied');

    const written = await readFile(file, 'utf8');
    expect(written).toContain('<!-- evogen:change:');
    expect(written).toContain('新规则：写操作前先确认。');
    expect((await fileStore.listChanges()).length).toBe(1);
  });

  it('reverts exactly: the file digest returns to its pre-write value', async () => {
    const file = join(root, 'AGENTS.md');
    const before = 'existing rule\n';
    await writeFile(file, before, 'utf8');
    const adapter = createCodexAdapter({ projectRoot: root, codexHome: root, sessionsRoot: root });
    const fileStore = await store();
    const proposal = (await fileStore.getProposal('prop_1_000000'))!;
    const report = await applyProposal(adapter.surfaces, fileStore, sequentialIds(), systemClock(), proposal);
    expect(await readFile(file, 'utf8')).not.toBe(before);

    const changeId = report.records[0]!.changeId;
    await revertChange(adapter.surfaces, fileStore, changeId);
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(await fileStore.isChangeReverted(changeId)).toBe(true);
    // the record stays on file for auditability
    expect((await fileStore.listChanges()).length).toBe(1);
    // double revert is refused
    await expect(revertChange(adapter.surfaces, fileStore, changeId)).rejects.toThrow(/already reverted/);
  });

  it('refuses to apply over a drifted file and keeps the proposal retryable', async () => {
    const file = join(root, 'AGENTS.md');
    await writeFile(file, 'existing rule\n', 'utf8');
    const adapter = createCodexAdapter({ projectRoot: root, codexHome: root, sessionsRoot: root });
    const fileStore = await store();
    const proposal = (await fileStore.getProposal('prop_1_000000'))!;

    // tamper inside the plan->apply window: wrap plan to modify the file
    // after the diff was computed, which is exactly what the drift guard
    // protects against
    const base = adapter.surfaces;
    const tamperedStore: SurfaceStore = {
      list: () => base.list(),
      read: (surface) => base.read(surface),
      digest: (surface) => base.digest(surface),
      plan: async (input) => {
        const step = await base.plan(input);
        await writeFile(file, 'tampered between plan and apply\n', 'utf8');
        return step;
      },
      apply: (step) => base.apply(step),
      revert: (change) => base.revert(change),
    };

    const report = await applyProposal(tamperedStore, fileStore, sequentialIds(), systemClock(), proposal);
    expect(report.records).toEqual([]);
    expect(report.failures.length).toBe(1);
    expect(report.failures[0]?.reason).toMatch(/changed since/i);
    expect(report.proposal.status).toBe('approved'); // nothing applied, retryable
  });

  it('handles partial failure: applied parts land, failures are reported', async () => {
    const file = join(root, 'AGENTS.md');
    await writeFile(file, 'existing rule\n', 'utf8');
    const adapter = createCodexAdapter({ projectRoot: root, codexHome: root, sessionsRoot: root });
    const fileStore = await store();
    const badExpression: Expression = {
      id: 'exp_2_000000',
      surfaceId: 'no-such-surface',
      op: 'append',
      payload: { content: 'x' },
      rationale: '',
      evidenceIds: [],
    };
    await fileStore.saveProposal(makeProposal({ extraExpressions: [badExpression] }));
    const proposal = (await fileStore.getProposal('prop_1_000000'))!;

    const report = await applyProposal(adapter.surfaces, fileStore, sequentialIds(), systemClock(), proposal);
    expect(report.records.length).toBe(1);
    expect(report.failures.length).toBe(1);
    expect(report.proposal.status).toBe('partially_applied');
    expect(await readFile(file, 'utf8')).toContain('新规则');
  });
});
