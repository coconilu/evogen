import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface UserModelConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly modelId: string;
}

const CONFIG_PATH = join(homedir(), '.evogen', 'config.json');

/**
 * The desktop console's primary way to configure a model: a plain JSON file
 * under the user's evogen home. The UI writes it through `evogen serve`;
 * env vars still take precedence for power users.
 */
export async function readUserModelConfig(path = CONFIG_PATH): Promise<UserModelConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { model?: Partial<UserModelConfig> };
    const model = parsed.model;
    if (!model?.baseUrl || !model?.apiKey || !model?.modelId) return undefined;
    return { baseUrl: model.baseUrl, apiKey: model.apiKey, modelId: model.modelId };
  } catch {
    return undefined;
  }
}

export async function writeUserModelConfig(config: UserModelConfig, path = CONFIG_PATH): Promise<void> {
  const payload = JSON.stringify({ model: config }, null, 2);
  await writeFile(path, `${payload}\n`, 'utf8');
}
