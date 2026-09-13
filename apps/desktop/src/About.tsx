import { getVersion } from '@tauri-apps/api/app';
import { useEffect, useState } from 'react';
import { Badge, Button, Card } from './ui';
import { checkNow, startInstall, useUpdateState } from './update';

/**
 * 「关于」页：版本信息与更新入口。更新状态来自全局共享模块（顶部横幅同源），
 * 手动「检查更新」与后台轮询共用一套结果。
 */
export function About() {
  const [version, setVersion] = useState('');
  const update = useUpdateState();

  useEffect(() => {
    if ('__TAURI_INTERNALS__' in window)
      getVersion()
        .then(setVersion)
        .catch(() => setVersion('?'));
    else setVersion('(浏览器调试)');
  }, []);

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
          {update.phase === 'idle' && (
            <p className="muted">启动时会自动检查更新，之后每 30 分钟一次；也可以手动检查。</p>
          )}
          {update.phase === 'checking' && <p>正在检查更新…</p>}
          {update.phase === 'up-to-date' && (
            <p>
              <Badge tone="ok">已是最新版本</Badge>
            </p>
          )}
          {update.phase === 'unavailable' && <p className="muted">检查失败：{update.reason}</p>}
          {update.phase === 'available' && (
            <p>
              发现新版本 <strong>v{update.version}</strong>
              （当前 v{update.currentVersion || version || '?'}）
            </p>
          )}
          {update.phase === 'downloading' && <p>下载中… {Math.round(update.progress * 100)}%</p>}
          {update.phase === 'installing' && <p>安装完成，重启应用后生效（Windows 通常会自动重启）。</p>}
          {update.phase === 'failed' && <p className="muted">安装失败：{update.reason}</p>}
          <div className="row">
            <Button variant="ghost" onClick={checkNow} disabled={update.phase === 'checking'}>
              检查更新
            </Button>
            {update.phase === 'available' && <Button onClick={startInstall}>立即更新</Button>}
          </div>
        </div>
      </Card>
    </div>
  );
}
