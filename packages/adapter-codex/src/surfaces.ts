import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  ApplyStep,
  ChangeRecord,
  PlanInput,
  SurfaceKind,
  SurfaceOp,
  SurfaceSpec,
  SurfaceStore,
} from '@evogen/kernel';

/** Marker that makes every appended change findable, verifiable and removable. */
export function changeMarker(changeId: string): { open: string; close: string } {
  return { open: `<!-- evogen:change:${changeId} -->`, close: `<!-- /evogen:change:${changeId} -->` };
}

function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 32);
}

async function exists(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => undefined);
  return info !== undefined;
}

export interface CodexSurfaceStoreOptions {
  /** Project whose instruction file we may edit. */
  readonly projectRoot: string;
  /** Host state directory (holds the user-level instruction file). */
  readonly codexHome: string;
}

/**
 * Instruction surfaces of a Codex-style runtime: the project's `AGENTS.md`, the
 * user-level `AGENTS.md`, and any skill documents below `.agents/skills`.
 *
 * Writes are append-only by default. An appended change is wrapped in a marker
 * block so it can be removed exactly, without touching the rest of the file.
 */
export class CodexSurfaceStore implements SurfaceStore {
  private readonly projectRoot: string;
  private readonly codexHome: string;

  constructor(options: CodexSurfaceStoreOptions) {
    this.projectRoot = options.projectRoot;
    this.codexHome = options.codexHome;
  }

  async list(): Promise<readonly SurfaceSpec[]> {
    const specs: SurfaceSpec[] = [];
    specs.push(await this.spec('agents.project', 'instructions', join(this.projectRoot, 'AGENTS.md')));
    specs.push(await this.spec('agents.user', 'instructions', join(this.codexHome, 'AGENTS.md')));
    for (const path of await this.listSkillDocs()) {
      const name = path.split(/[\\/]/).slice(-2)[0] ?? 'skill';
      specs.push(await this.spec(`skill.${name}`, 'skill', path));
    }
    return specs;
  }

  async read(surface: SurfaceSpec): Promise<string> {
    return readFile(surface.path, 'utf8').catch(() => '');
  }

  async digest(surface: SurfaceSpec): Promise<string> {
    return digest(await this.read(surface));
  }

  async plan(input: PlanInput): Promise<ApplyStep> {
    const before = input.surface.exists ? await this.read(input.surface) : '';
    return {
      changeId: input.changeId,
      expressionId: input.expressionId,
      surfaceId: input.surface.id,
      path: input.surface.path,
      op: input.op,
      payload: input.payload,
      before,
      after: this.computeAfter(before, input.op, input.payload.content, input.payload.before, input.changeId),
      appliedAt: input.at.toISOString(),
    };
  }

  async apply(step: ApplyStep): Promise<ChangeRecord> {
    await mkdir(dirname(step.path), { recursive: true });
    const before = await readFile(step.path, 'utf8').catch(() => '');
    if (before !== step.before) {
      throw new Error(
        `surface changed since the diff was rendered (${step.path}); re-run the proposal before applying`,
      );
    }
    await writeFile(step.path, step.after, 'utf8');
    return {
      changeId: step.changeId,
      expressionId: step.expressionId,
      surfaceId: step.surfaceId,
      path: step.path,
      op: step.op,
      beforeDigest: digest(step.before),
      afterDigest: digest(step.after),
      appliedAt: step.appliedAt,
    };
  }

  async revert(change: ChangeRecord): Promise<void> {
    if (change.op !== 'append') {
      throw new Error(
        `change ${change.changeId} used op "${change.op}" and is not wrapped in a marker block; ` +
          'revert it from the diff you reviewed',
      );
    }
    const current = await readFile(change.path, 'utf8');
    const { open, close } = changeMarker(change.changeId);
    const start = current.indexOf(open);
    const end = current.indexOf(close);
    if (start === -1 || end === -1 || end < start) {
      throw new Error(`marker block for ${change.changeId} not found in ${change.path}`);
    }
    const head = current.slice(0, start).replace(/\s+$/, '');
    const tail = current.slice(end + close.length).replace(/^\s+/, '');
    const next = head === '' ? `${tail}` : tail === '' ? `${head}\n` : `${head}\n\n${tail}`;
    await writeFile(change.path, next, 'utf8');
  }

  private computeAfter(
    before: string,
    op: SurfaceOp,
    content: string,
    previous: string | undefined,
    changeId: string,
  ): string {
    if (op === 'replace') {
      if (previous === undefined) {
        throw new Error('op "replace" requires payload.before (the exact text to substitute)');
      }
      if (before === '') return content;
      if (!before.includes(previous)) {
        throw new Error('op "replace" target text not found in the surface');
      }
      return before.replace(previous, content);
    }
    const { open, close } = changeMarker(changeId);
    const head = before.replace(/\s+$/, '');
    const prefix = head === '' ? '' : `${head}\n\n`;
    return `${prefix}${open}\n${content}\n${close}\n`;
  }

  private async spec(id: string, kind: SurfaceKind, path: string): Promise<SurfaceSpec> {
    return {
      id,
      kind,
      path,
      supportedOps: ['append', 'replace'],
      exists: await exists(path),
    };
  }

  private async listSkillDocs(): Promise<readonly string[]> {
    const base = join(this.projectRoot, '.agents', 'skills');
    const dirs = await readdir(base, { withFileTypes: true }).catch(() => []);
    const found: string[] = [];
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      const doc = join(base, entry.name, 'SKILL.md');
      if (await exists(doc)) found.push(doc);
    }
    return found;
  }
}
