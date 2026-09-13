export interface ModelRequest {
  readonly system?: string;
  readonly prompt: string;
  /** `json` asks the implementation to return a single JSON document. */
  readonly responseFormat?: 'text' | 'json';
  readonly maxOutputTokens?: number;
}

export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ModelResponse {
  readonly text: string;
  readonly model: string;
  readonly usage?: ModelUsage;
}

/**
 * The only way the kernel can ask a model for anything. This repository ships
 * no implementation: callers inject one, so no model vendor is baked in.
 */
export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}
