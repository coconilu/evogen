import type { ModelClient, ModelRequest, ModelResponse } from '@evogen/kernel';
import { loadDotEnvLocal } from './env.js';

export interface ModelConfig {
  /** Root of a chat-completions compatible endpoint, e.g. https://host/v1 */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly modelId: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Resolution order: process env, then `.env.local` in `cwd`.
 * Required keys: EVOGEN_MODEL_BASE_URL, EVOGEN_MODEL_API_KEY, EVOGEN_MODEL_ID.
 */
export async function resolveModelConfig(cwd: string): Promise<ModelConfig | undefined> {
  const file = await loadDotEnvLocal(cwd);
  const get = (key: string): string | undefined => process.env[key] ?? file[key];
  const baseUrl = get('EVOGEN_MODEL_BASE_URL');
  const apiKey = get('EVOGEN_MODEL_API_KEY');
  const modelId = get('EVOGEN_MODEL_ID');
  if (!baseUrl || !apiKey || !modelId) return undefined;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    modelId,
    timeoutMs: positiveInt(get('EVOGEN_MODEL_TIMEOUT_MS'), DEFAULT_TIMEOUT_MS),
    maxRetries: positiveInt(get('EVOGEN_MODEL_MAX_RETRIES'), DEFAULT_MAX_RETRIES),
  };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

interface ChatMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

/**
 * ModelClient over the industry-standard chat-completions HTTP protocol.
 * The endpoint, key and model all come from configuration; nothing here knows
 * or cares which provider is behind the URL.
 */
export class ChatCompletionsClient implements ModelClient {
  constructor(private readonly config: ModelConfig) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const messages: ChatMessage[] = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.prompt });

    const body: Record<string, unknown> = { model: this.config.modelId, messages };
    if (request.maxOutputTokens !== undefined) body['max_tokens'] = request.maxOutputTokens;
    if (request.responseFormat === 'json') body['response_format'] = { type: 'json_object' };

    let lastError = '';
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      if (attempt > 0) await sleep(backoffMs(attempt));
      try {
        return await this.attempt(body);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (!isRetryable(lastError)) break;
      }
    }
    throw new Error(`model request failed: ${lastError}`);
  }

  private async attempt(body: Record<string, unknown>): Promise<ModelResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const snippet = (await response.text()).slice(0, 300);
        if (
          response.status === 400 &&
          body['response_format'] !== undefined &&
          /response_format|json_object/i.test(snippet)
        ) {
          // some compatible endpoints reject json mode; degrade gracefully
          const fallback = { ...body };
          delete fallback['response_format'];
          return await this.attempt(fallback);
        }
        throw new Error(`HTTP ${response.status}: ${redact(snippet, this.config.apiKey)}`);
      }
      const data = (await response.json()) as {
        model?: string;
        choices?: ReadonlyArray<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error('model returned no message content');
      return {
        text,
        model: data.model ?? this.config.modelId,
        usage: {
          inputTokens: data.usage?.prompt_tokens,
          outputTokens: data.usage?.completion_tokens,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`timeout after ${this.config.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function isRetryable(message: string): boolean {
  return /HTTP (429|5\d\d)|timeout|fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(message);
}

function backoffMs(attempt: number): number {
  return Math.round(1000 * 1.5 ** attempt + Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redact(text: string, secret: string): string {
  return secret.length > 0 ? text.replaceAll(secret, '***') : text;
}
