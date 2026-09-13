import {
  createEvolutionPipeline,
  createMemoryStore,
  type ModelRequest,
  type PipelineContext,
  type RawSession,
  runEvolution,
  type SessionSource,
  type SurfaceStore,
  sequentialIds,
  systemClock,
} from '@evogen/kernel';
import { describe, expect, it } from 'vitest';

/** Scripted model: the first matching route wins. */
function fakeModel(routes: ReadonlyArray<{ match: string; respond: (prompt: string) => string }>) {
  const calls: ModelRequest[] = [];
  return {
    calls,
    complete: async (request: ModelRequest) => {
      calls.push(request);
      const prompt = `${request.system ?? ''}\n${request.prompt}`;
      for (const route of routes) {
        if (prompt.includes(route.match)) return { text: route.respond(prompt), model: 'fake' };
      }
      throw new Error('fake model: no route matched');
    },
  };
}

function session(id: string, text: string): RawSession {
  return {
    ref: { id, path: `${id}.jsonl`, mtimeMs: 1 },
    meta: { host: 'test' },
    turns: [{ role: 'user', text }],
  };
}

function fakeSessions(sessions: readonly RawSession[]): SessionSource {
  return {
    host: 'test',
    list: async () => sessions.map((s) => s.ref),
    read: async (ref) => {
      const found = sessions.find((s) => s.ref.id === ref.id);
      if (!found) throw new Error(`unknown session ${ref.id}`);
      return found;
    },
  };
}

function fakeSurfaces(surfaces: ReadonlyArray<{ id: string; content: string }>): SurfaceStore {
  const list = surfaces.map((surface) => ({
    id: surface.id,
    kind: 'instructions' as const,
    path: `/${surface.id}.md`,
    supportedOps: ['append', 'replace'] as const,
    exists: true,
  }));
  const byId = new Map(surfaces.map((surface) => [surface.id, surface.content]));
  return {
    list: async () => list,
    read: async (spec) => byId.get(spec.id) ?? '',
    digest: async (spec) => `${spec.id}-digest`,
    plan: async (input) => ({
      changeId: input.changeId,
      expressionId: input.expressionId,
      surfaceId: input.surface.id,
      path: input.surface.path,
      op: input.op,
      payload: input.payload,
      before: byId.get(input.surface.id) ?? '',
      after: `${byId.get(input.surface.id) ?? ''}\n${input.payload.content}\n`,
      appliedAt: input.at.toISOString(),
    }),
    apply: async () => {
      throw new Error('apply must not be called in read-only runs');
    },
    revert: async () => {
      throw new Error('revert must not be called in read-only runs');
    },
  };
}

const DISTILL_ROUTE = {
  match: '工程会话分析器',
  respond: (prompt: string) => {
    if (prompt.includes('会话 S1')) {
      return JSON.stringify({
        evidence: [
          { kind: 'correction', quote: 'use pnpm instead of npm', note: '包管理器用 pnpm', confidence: 0.9 },
        ],
      });
    }
    if (prompt.includes('会话 S2')) {
      return JSON.stringify({
        evidence: [
          { kind: 'correction', quote: 'use pnpm instead of npm', note: '包管理器用 pnpm', confidence: 0.9 },
        ],
      });
    }
    return '{"evidence":[]}';
  },
};

const PROPOSE_ROUTE = {
  match: '指令文件的维护者',
  respond: (prompt: string) => {
    // echo back an evidence id the model actually saw, like a real model would
    const evidenceId = /ev_[0-9a-z]+_[0-9a-z]+/.exec(prompt)?.[0] ?? '';
    return JSON.stringify({
      title: '包管理器',
      expressions: [
        {
          surfaceId: 'agents.project',
          op: 'append',
          content: '包管理器一律使用 pnpm，不要使用 npm。',
          rationale: '用户多次纠正',
          evidenceIds: evidenceId.length > 0 ? [evidenceId] : [],
        },
      ],
    });
  },
};

const CRITIQUE_OK = {
  match: '自检者',
  respond: () => JSON.stringify({ risk: 0.1, confidence: 0.9, notes: 'ok', drop: [], revise: [] }),
};

function makeCtx(
  model: ReturnType<typeof fakeModel>,
  surfaceContent = '# existing rules\n- keep tests green',
): PipelineContext {
  return {
    sessions: fakeSessions([session('S1', '会话 S1: please use pnpm instead of npm')]),
    surfaces: fakeSurfaces([{ id: 'agents.project', content: surfaceContent }]),
    store: createMemoryStore(),
    model,
    clock: systemClock(),
    ids: sequentialIds(),
  };
}

describe('createEvolutionPipeline end to end (fake model)', () => {
  it('runs all five stages and produces an audited proposal', async () => {
    const model = fakeModel([DISTILL_ROUTE, PROPOSE_ROUTE, CRITIQUE_OK]);
    const run = await runEvolution(createEvolutionPipeline(), makeCtx(model));

    expect(run.stages.map((stage) => stage.name)).toEqual([
      'collect',
      'distill',
      'aggregate',
      'propose',
      'critique',
    ]);
    expect(run.stages[0]?.itemCount).toBe(1); // sessions
    expect(run.proposal?.title).toBe('包管理器');
    expect(model.calls.length).toBe(3); // distill, propose, critique
  });

  it('proposals only carry append expressions on known surfaces, with valid evidence only', async () => {
    const model = fakeModel([DISTILL_ROUTE, PROPOSE_ROUTE, CRITIQUE_OK]);
    const run = await runEvolution(createEvolutionPipeline(), makeCtx(model));

    const expressions = run.proposal?.expressions ?? [];
    expect(expressions.length).toBe(1);
    expect(expressions[0]?.op).toBe('append');
    expect(expressions[0]?.evidenceIds.length).toBe(1); // echoed evidence id accepted
    expect(run.proposal?.signals.length).toBe(1); // signal contributed by the expression
  });

  it('drops expressions that duplicate existing surface content', async () => {
    const duplicated = {
      ...PROPOSE_ROUTE,
      respond: () =>
        JSON.stringify({
          title: 't',
          expressions: [
            {
              surfaceId: 'agents.project',
              op: 'append',
              content: 'keep tests green',
              rationale: '',
              evidenceIds: [],
            },
            { surfaceId: 'agents.project', op: 'replace', content: '替换', rationale: '', evidenceIds: [] },
            { surfaceId: 'unknown-surface', op: 'append', content: 'abc', rationale: '', evidenceIds: [] },
          ],
        }),
    };
    const model = fakeModel([DISTILL_ROUTE, duplicated, CRITIQUE_OK]);
    const run = await runEvolution(createEvolutionPipeline(), makeCtx(model));
    expect(run.proposal?.expressions).toEqual([]);
  });

  it('aggregates identical corrections from two sessions into one weighted signal', async () => {
    const model = fakeModel([DISTILL_ROUTE, PROPOSE_ROUTE, CRITIQUE_OK]);
    const ctx = makeCtx(model);
    // second session says the same thing: S2 route mirrors S1
    ctx.sessions = fakeSessions([
      session('S1', '会话 S1: use pnpm instead of npm'),
      session('S2', '会话 S2: use pnpm instead of npm'),
    ]);

    const run = await runEvolution(createEvolutionPipeline(), ctx);
    const signals = run.proposal?.signals ?? [];
    expect(signals.length).toBe(1);
    expect(signals[0]?.weight).toBe(2);
    expect(signals[0]?.evidenceIds.length).toBe(2);
  });

  it('applies critique clamping (risk 5 -> 1, confidence -1 -> 0)', async () => {
    const critique = {
      match: '自检者',
      respond: () => JSON.stringify({ risk: 5, confidence: -1, notes: 'clamped', drop: [], revise: [] }),
    };
    const model = fakeModel([DISTILL_ROUTE, PROPOSE_ROUTE, critique]);
    const run = await runEvolution(createEvolutionPipeline(), makeCtx(model));
    expect(run.proposal?.critique?.risk).toBe(1);
    expect(run.proposal?.critique?.confidence).toBe(0);
    expect(run.proposal?.expressions.length).toBe(1);
  });

  it('keeps the proposal when the critique call fails', async () => {
    const model = fakeModel([DISTILL_ROUTE, PROPOSE_ROUTE]);
    const run = await runEvolution(createEvolutionPipeline(), makeCtx(model));
    expect(run.proposal?.expressions.length).toBe(1);
    expect(run.proposal?.critique?.notes).toContain('unavailable');
  });

  it('fails loudly when every distill call errors', async () => {
    // no distill route: the fake model throws for every session
    const model = fakeModel([PROPOSE_ROUTE, CRITIQUE_OK]);
    await expect(runEvolution(createEvolutionPipeline(), makeCtx(model))).rejects.toThrow(
      /distill failed for all 1 sessions/,
    );
  });
});
