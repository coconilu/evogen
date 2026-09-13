import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { RawSession, SessionMeta, SessionRef, SessionTurn, SessionSource } from '@evogen/kernel';

/** Keep reasoned-over text bounded: per turn, and per session. */
const MAX_TEXT_CHARS = 1500;
const MAX_TURNS = 60;
const MAX_FILES = 2000;
const MAX_DEPTH = 6;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null ? (value as JsonObject) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function clip(text: string): string {
  return text.length <= MAX_TEXT_CHARS ? text : `${text.slice(0, MAX_TEXT_CHARS)} …[clipped]`;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

export interface CodexSessionSourceOptions {
  /** Directory containing `*.jsonl` session logs. */
  readonly root?: string;
  /** Maximum number of sessions to expose (newest first). */
  readonly limit?: number;
}

async function walkJsonl(dir: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    if (found.length >= MAX_FILES) break;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkJsonl(full, depth + 1)));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      found.push(full);
    }
  }
  return found.slice(0, MAX_FILES);
}

/**
 * Reads the host's local session logs.
 *
 * Only conversational content is kept: user/assistant messages and tool calls.
 * System-level context and internal reasoning are dropped on purpose — they are
 * not evidence of what to change, and they are the most sensitive part.
 */
export class CodexSessionSource implements SessionSource {
  readonly host = 'codex';
  private readonly root: string;
  private readonly limit: number;

  constructor(options: CodexSessionSourceOptions = {}) {
    this.root = options.root ?? '';
    this.limit = options.limit ?? 1000;
  }

  get rootDir(): string {
    return this.root;
  }

  async list(): Promise<readonly SessionRef[]> {
    const paths = await walkJsonl(this.root);
    const refs: SessionRef[] = [];
    for (const path of paths) {
      const info = await stat(path).catch(() => undefined);
      if (!info) continue;
      const file = path.split(/[\\/]/).pop() ?? path;
      refs.push({ id: file.replace(/\.jsonl$/, ''), path, mtimeMs: info.mtimeMs });
    }
    refs.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return refs.slice(0, this.limit);
  }

  async read(ref: SessionRef): Promise<RawSession> {
    const raw = await readFile(ref.path, 'utf8').catch(() => '');
    const turns: SessionTurn[] = [];
    const meta: { model?: string; cwd?: string; startedAt?: string } = {};

    for (const line of raw.split(/\r?\n/)) {
      if (turns.length >= MAX_TURNS) break;
      const trimmed = line.trim();
      if (trimmed === '') continue;
      let record: JsonObject;
      try {
        record = JSON.parse(trimmed) as JsonObject;
      } catch {
        continue;
      }
      const type = asString(record['type']);
      const payload = asObject(record['payload']);
      if (!payload) continue;

      if (type === 'session_meta') {
        meta.cwd = asString(payload['cwd']) ?? meta.cwd;
        meta.model = asString(payload['model_provider']) ?? meta.model;
        meta.startedAt = asString(payload['timestamp']) ?? asString(record['timestamp']) ?? meta.startedAt;
        continue;
      }
      if (type !== 'response_item') continue;

      const itemType = asString(payload['type']);
      if (itemType === 'message') {
        const role = asString(payload['role']);
        if (role !== 'user' && role !== 'assistant') continue; // system-level context is skipped
        const text = readMessageText(payload['content']);
        if (text !== '') turns.push({ role, text: clip(text) });
        continue;
      }
      if (itemType === 'function_call') {
        turns.push({
          role: 'assistant',
          tool: asString(payload['name']) ?? 'unknown',
          args: clip(stringify(payload['arguments'])),
        });
        continue;
      }
      if (itemType === 'function_call_output') {
        turns.push({
          role: 'tool',
          tool: asString(payload['call_id']) ?? '',
          result: clip(stringify(payload['output'])),
        });
      }
      // `reasoning` and any future item types are intentionally ignored.
    }

    const result: SessionMeta = { host: this.host, ...meta };
    return { ref, meta: result, turns };
  }
}

function readMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    const obj = asObject(block);
    if (!obj) continue;
    const type = asString(obj['type']);
    if (type === 'input_text' || type === 'output_text' || type === 'text') {
      const text = asString(obj['text']);
      if (text) parts.push(text);
    }
  }
  return parts.join('\n');
}
