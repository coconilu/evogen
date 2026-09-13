import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { ConfigTestResult, ModelConfigView } from './types';
import { Badge, Button, Card } from './ui';

const SOURCE_LABEL: Record<string, string> = {
  env: '环境变量',
  'env-file': '.env.local 文件',
  'user-config': '本页保存的配置',
};

/**
 * 设置页：模型端点的可见配置入口。保存在 ~/.evogen/config.json，
 * 环境变量仍可覆盖（面向高级用户），API Key 永远不会回传到界面。
 */
export function Settings() {
  const [config, setConfig] = useState<ModelConfigView | undefined>();
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<ConfigTestResult | undefined>();

  const refresh = useCallback(() => {
    api
      .getConfig()
      .then((next) => {
        setConfig(next);
        setBaseUrl(next.baseUrl);
        setModelId(next.modelId);
        setError('');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(refresh, [refresh]);

  const save = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const next = await api.saveConfig({
        baseUrl,
        modelId,
        ...(apiKey ? { apiKey } : {}),
      });
      setConfig(next);
      setApiKey('');
      setSaved(true);
      setTest(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(undefined);
    try {
      setTest(await api.testConfig());
    } catch (err) {
      setTest({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="stack">
      <Card title="模型配置">
        <p className="muted">
          evogen 分析会话时调用一个 chat-completions 兼容的模型端点。配置保存在
          <span className="mono"> ~/.evogen/config.json </span>，只在本机使用，不会上传。
        </p>
        <div className="form">
          <label>
            接口地址
            <input
              className="input wide"
              value={baseUrl}
              placeholder="例如 https://api.example.com/v1"
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label>
            API Key
            <input
              className="input wide"
              type="password"
              value={apiKey}
              placeholder={config?.apiKeySet ? '已配置——留空表示保持不变' : 'sk-…'}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <label>
            模型 ID
            <input
              className="input wide"
              value={modelId}
              placeholder="例如 deepseek-flash"
              onChange={(event) => setModelId(event.target.value)}
            />
          </label>
          <div className="row">
            <Button onClick={save} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
            <Button variant="ghost" onClick={runTest} disabled={testing}>
              {testing ? '测试中…' : '测试连接'}
            </Button>
            {saved && <Badge tone="ok">已保存</Badge>}
            {config?.apiKeySet && (
              <Badge tone="muted">密钥来源：{SOURCE_LABEL[config.source ?? ''] ?? config.source}</Badge>
            )}
          </div>
          {error && <p className="error-text">{error}</p>}
          {test && test.ok && (
            <p>
              <Badge tone="ok">连接正常 ✓</Badge> 模型 {test.model}
            </p>
          )}
          {test && !test.ok && <p className="error-text">测试失败：{test.error}</p>}
          <p className="muted">
            高级用户也可以用 EVOGEN_MODEL_* 环境变量配置（优先级更高）；当前状态：
            {config?.apiKeySet ? `已配置（${SOURCE_LABEL[config.source ?? ''] ?? config.source}）` : '未配置'}
          </p>
        </div>
      </Card>
    </div>
  );
}
