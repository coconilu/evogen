import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDotEnvLocal } from '../src/config/env.js';
import { ChatCompletionsClient, resolveModelConfig } from '../src/config/model.js';
import { renderDiff } from '../src/diff.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CONFIG = {
  baseUrl: 'https://api.test/v1',
  apiKey: 'secret-key',
  modelId: 'test-model',
  timeoutMs: 5_000,
  maxRetries: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function completion(text: string): unknown {
  return {
    model: 'test-model',
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
  };
}

describe('ChatCompletionsClient', () => {
  it('posts to /chat/completions with bearer auth and maps the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(completion('pong')));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ChatCompletionsClient(CONFIG);

    const response = await client.complete({ prompt: 'ping' });
    expect(response.text).toBe('pong');
    expect(response.usage).toEqual({ inputTokens: 11, outputTokens: 7 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer secret-key');
    const body = JSON.parse(String(init.body)) as { model: string; messages: unknown[] };
    expect(body.model).toBe('test-model');
    expect(body.messages).toEqual([{ role: 'user', content: 'ping' }]);
  });

  it('degrades gracefully when an endpoint rejects json mode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'response_format is not supported' } }, 400))
      .mockResolvedValueOnce(jsonResponse(completion('{"ok":true}')));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ChatCompletionsClient(CONFIG);

    const response = await client.complete({ prompt: 'x', responseFormat: 'json' });
    expect(response.text).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(
      String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body),
    ) as Record<string, unknown>;
    expect(secondBody['response_format']).toBeUndefined();
  });

  it('does not retry client errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ChatCompletionsClient({ ...CONFIG, maxRetries: 3 });

    await expect(client.complete({ prompt: 'x' })).rejects.toThrow(/HTTP 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries server errors and never leaks the key in error messages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'boom secret-key' }, 500))
      .mockResolvedValueOnce(jsonResponse(completion('ok')));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ChatCompletionsClient({ ...CONFIG, maxRetries: 1 });

    const response = await client.complete({ prompt: 'x' });
    expect(response.text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('resolveModelConfig', () => {
  it('combines process env and .env.local, with env winning', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'evogen-env-'));
    const dir = await mkdtemp(join(tmpdir(), 'evogen-env-'));
    await writeFile(
      join(dir, '.env.local'),
      [
        'EVOGEN_MODEL_BASE_URL=https://from-file/v1',
        'EVOGEN_MODEL_API_KEY=file-key',
        'EVOGEN_MODEL_ID=file-model',
        '',
      ].join('\n'),
      'utf8',
    );
    const previous = { ...process.env };
    try {
      delete process.env.EVOGEN_MODEL_BASE_URL;
      delete process.env.EVOGEN_MODEL_API_KEY;
      delete process.env.EVOGEN_MODEL_ID;

      // nothing configured anywhere
      expect(await resolveModelConfig(emptyDir)).toBeUndefined();

      process.env.EVOGEN_MODEL_API_KEY = 'env-key';
      const config = await resolveModelConfig(dir);
      expect(config?.baseUrl).toBe('https://from-file/v1'); // from file
      expect(config?.apiKey).toBe('env-key'); // env wins
      expect(config?.modelId).toBe('file-model'); // from file
    } finally {
      process.env = previous;
    }
  });
});

describe('loadDotEnvLocal', () => {
  it('parses comments, quotes and export prefixes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evogen-env-'));
    await writeFile(
      join(dir, '.env.local'),
      ['# comment', 'A=1', 'B = "two words"', "export C='three'", 'no_equals_line', ''].join('\n'),
      'utf8',
    );
    expect(await loadDotEnvLocal(dir)).toEqual({ A: '1', B: 'two words', C: 'three' });
  });

  it('returns empty when the file is missing', async () => {
    expect(await loadDotEnvLocal(await mkdtemp(join(tmpdir(), 'evogen-env-')))).toEqual({});
  });
});

describe('renderDiff', () => {
  it('shows additions with context', () => {
    const diff = renderDiff('a\nb\nc\n', 'a\nb\nc\nd\n');
    expect(diff.split('\n')).toEqual(['  …', '  b', '  c', '+ d']);
  });

  it('marks removals and keeps unrelated regions elided', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 10', 'line 10 changed');
    const diff = renderDiff(before, after);
    expect(diff).toContain('- line 10');
    expect(diff).toContain('+ line 10 changed');
    expect(diff).toContain('…');
    expect(diff).not.toContain('line 0');
  });

  it('handles empty before', () => {
    expect(renderDiff('', 'new\n')).toBe('+ new');
  });
});
