import { createMemoryStore, sequentialIds, systemClock } from '@evogen/kernel';
import { describe, expect, it } from 'vitest';

describe('sequentialIds', () => {
  it('produces unique ids with the requested prefix', () => {
    const ids = sequentialIds();
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) seen.add(ids.next('ev'));
    expect(seen.size).toBe(100);
    for (const id of seen) expect(id.startsWith('ev_')).toBe(true);
  });
});

describe('systemClock', () => {
  it('returns advancing dates', () => {
    const clock = systemClock();
    expect(clock.now().getTime()).toBeLessThanOrEqual(clock.now().getTime());
  });
});

describe('createMemoryStore', () => {
  it('upserts proposals by id and filters by status', async () => {
    const store = createMemoryStore();
    const base = {
      createdAt: '2026-01-01T00:00:00.000Z',
      signals: [],
      expressions: [],
    };
    await store.saveProposal({ ...base, id: 'p1', title: 'a', status: 'draft' });
    await store.saveProposal({ ...base, id: 'p2', title: 'b', status: 'approved' });
    await store.saveProposal({ ...base, id: 'p1', title: 'a2', status: 'approved' });

    expect((await store.listProposals()).length).toBe(2);
    expect((await store.getProposal('p1'))?.title).toBe('a2');
    expect((await store.listProposals({ status: 'approved' })).map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('keeps change records in order', async () => {
    const store = createMemoryStore();
    const change = {
      changeId: 'c1',
      expressionId: 'e1',
      surfaceId: 's',
      path: '/p',
      op: 'append' as const,
      beforeDigest: 'a',
      afterDigest: 'b',
      appliedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.appendChange(change);
    expect(await store.listChanges()).toEqual([change]);
  });
});
