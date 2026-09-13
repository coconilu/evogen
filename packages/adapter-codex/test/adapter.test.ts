import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexAdapter } from '@evogen/adapter-codex';
import { beforeEach, describe, expect, it } from 'vitest';

let root: string;
let home: string;
let sessions: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'evogen-root-'));
  home = await mkdtemp(join(tmpdir(), 'evogen-home-'));
  sessions = await mkdtemp(join(tmpdir(), 'evogen-sessions-'));
});

describe('CodexSessionSource', () => {
  it('parses jsonl sessions into turns', async () => {
    const lines = [
      JSON.stringify({ type: 'session_meta', payload: { cwd: root, model_provider: 'test-provider' } }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello there' }] },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', name: 'shell', arguments: '{"cmd":"ls"}' },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'c1', output: 'file.txt' },
      }),
      JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', summary: [] } }),
    ];
    await writeFile(join(sessions, 's1.jsonl'), lines.join('\n'), 'utf8');

    const adapter = createCodexAdapter({ projectRoot: root, codexHome: home, sessionsRoot: sessions });
    const refs = await adapter.sessions.list();
    expect(refs.length).toBe(1);

    const parsed = await adapter.sessions.read(refs[0]!);
    expect(parsed.meta.cwd).toBe(root);
    expect(parsed.turns.length).toBe(4); // reasoning dropped
    expect(parsed.turns[0]).toMatchObject({ role: 'user', text: 'hello there' });
    expect(parsed.turns[2]).toMatchObject({ role: 'assistant', tool: 'shell' });
    expect(parsed.turns[3]).toMatchObject({ role: 'tool', result: 'file.txt' });
  });
});

describe('CodexSurfaceStore', () => {
  it('enumerates project and user instruction surfaces', async () => {
    await writeFile(join(root, 'AGENTS.md'), '# project rules\n', 'utf8');
    const adapter = createCodexAdapter({ projectRoot: root, codexHome: home, sessionsRoot: sessions });

    const specs = await adapter.surfaces.list();
    const project = specs.find((spec) => spec.id === 'agents.project');
    const user = specs.find((spec) => spec.id === 'agents.user');
    expect(project?.exists).toBe(true);
    expect(user?.exists).toBe(false);
  });

  it('plans, applies and reverts a marked append block', async () => {
    const file = join(root, 'AGENTS.md');
    await writeFile(file, 'first rule\n', 'utf8');
    const adapter = createCodexAdapter({ projectRoot: root, codexHome: home, sessionsRoot: sessions });
    const spec = (await adapter.surfaces.list()).find((item) => item.id === 'agents.project')!;

    const step = await adapter.surfaces.plan({
      surface: spec,
      op: 'append',
      payload: { content: 'second rule' },
      changeId: 'c1',
      expressionId: 'e1',
      at: new Date(0),
    });
    expect(step.before).toBe('first rule\n');
    expect(step.after).toContain('<!-- evogen:change:c1 -->');
    expect(step.after).toContain('second rule');

    const change = await adapter.surfaces.apply(step);
    expect(change.beforeDigest).not.toBe(change.afterDigest);
    const written = await readFile(file, 'utf8');
    expect(written).toContain('<!-- evogen:change:c1 -->');

    await adapter.surfaces.revert(change);
    expect(await readFile(file, 'utf8')).toBe('first rule\n');
  });

  it('refuses to apply when the file drifted after planning', async () => {
    const file = join(root, 'AGENTS.md');
    await writeFile(file, 'first rule\n', 'utf8');
    const adapter = createCodexAdapter({ projectRoot: root, codexHome: home, sessionsRoot: sessions });
    const spec = (await adapter.surfaces.list()).find((item) => item.id === 'agents.project')!;

    const step = await adapter.surfaces.plan({
      surface: spec,
      op: 'append',
      payload: { content: 'second rule' },
      changeId: 'c2',
      expressionId: 'e2',
      at: new Date(0),
    });
    await writeFile(file, 'someone else touched this\n', 'utf8');
    await expect(adapter.surfaces.apply(step)).rejects.toThrow(/changed since/i);
  });

  it('lists skill surfaces from .agents/skills', async () => {
    const skillDir = join(root, '.agents', 'skills', 'demo');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo\n---\nbody\n', 'utf8');
    const adapter = createCodexAdapter({ projectRoot: root, codexHome: home, sessionsRoot: sessions });

    const specs = await adapter.surfaces.list();
    const skill = specs.find((item) => item.id === 'skill.demo');
    expect(skill?.kind).toBe('skill');
    expect(skill?.exists).toBe(true);
  });
});
