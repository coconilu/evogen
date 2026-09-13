import { getVersion } from '@tauri-apps/api/app';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { useEffect, useState } from 'react';
import { Badge, Button, Card } from './ui';

type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'unavailable'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'failed';

/**
 * 更新管线已端到端接好；更新源在首次发版生成 minisign 密钥后才会生效。
 * 所有失败路径都安静地显示在面板里，不打断使用。
 */
export function About() {
  const [version, setVersion] = useState('');
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [reason, setReason] = useState('');
  const [found, setFound] = useState<Update | undefined>();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if ('__TAURI_INTERNALS__' in window)
      getVersion()
        .then(setVersion)
        .catch(() => setVersion('?'));
    else setVersion('(浏览器调试)');
  }, []);

  const runCheck = async () => {
    setPhase('checking');
    try {
      const update = await check({ timeout: 10_000 });
      if (update) {
        setFound(update);
        setPhase('available');
      } else {
        setFound(undefined);
        setPhase('up-to-date');
      }
    } catch (error) {
      setReason(error instanceof Error ? error.message : String(error));
      setPhase('unavailable');
    }
  };

  const runInstall = async () => {
    if (!found) return;
    setProgress(0);
    setPhase('downloading');
    try {
      await found.downloadAndInstall((event) => {
        if (event.event === 'Started') setProgress(0.01);
        else if (event.event === 'Finished') setProgress(1);
      });
      setPhase('installing');
    } catch (error) {
      setReason(error instanceof Error ? error.message : String(error));
      setPhase('failed');
    }
  };

  return (
    <div className="stack">
      <Card title="关于">
        <p>
          <strong>Evogen Studio</strong> — evogen 的桌面控制台
        </p>
        <p className="muted">
          让 AI 编码助手从自己的会话里学习，把教训沉淀回它的指令文件。全部逻辑在本机运行，不上传会话。
        </p>
        <dl className="kv">
          <dt>当前版本</dt>
          <dd className="mono">{version || '-'}</dd>
        </dl>
      </Card>

      <Card title="更新">
        <div className="stack">
          {phase === 'idle' && (
            <p className="muted">更新源将在首次正式发版时启用（需要生成 minisign 签名密钥）。</p>
          )}
          {phase === 'checking' && <p>正在检查更新…</p>}
          {phase === 'up-to-date' && (
            <p>
              <Badge tone="ok">已是最新版本</Badge>
            </p>
          )}
          {phase === 'unavailable' && <p className="muted">检查失败：{reason}</p>}
          {phase === 'available' && (
            <p>
              发现新版本 <strong>{found?.version}</strong>
              {found?.body ? <span className="muted"> — {found.body}</span> : null}
            </p>
          )}
          {phase === 'downloading' && <p>下载中… {Math.round(progress * 100)}%</p>}
          {phase === 'installing' && <p>安装完成，重启应用后生效。</p>}
          {phase === 'failed' && <p className="muted">安装失败：{reason}</p>}
          <div className="row">
            <Button variant="ghost" onClick={runCheck} disabled={phase === 'checking'}>
              检查更新
            </Button>
            {phase === 'available' && <Button onClick={runInstall}>立即更新</Button>}
          </div>
        </div>
      </Card>
    </div>
  );
}
