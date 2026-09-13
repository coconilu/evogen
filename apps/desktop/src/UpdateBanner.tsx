import { Button } from './ui';
import { dismissUpdate, isDismissed, startInstall, useUpdateState } from './update';

/** 顶部更新横幅：发现新版本时出现；可关闭且按版本记忆；下载/安装进度也在这一条里。 */
export function UpdateBanner() {
  const state = useUpdateState();

  if (state.phase === 'downloading' || state.phase === 'installing') {
    return (
      <div className="update-banner installing" role="status">
        {state.phase === 'downloading'
          ? `正在下载 v${state.version}… ${Math.round(state.progress * 100)}%`
          : '安装中，完成后如未自动重启请手动重启应用'}
        <div className="update-progress">
          <div className="update-progress-bar" style={{ width: `${Math.round(state.progress * 100)}%` }} />
        </div>
      </div>
    );
  }

  const show = state.phase === 'available' && state.version !== '' && !isDismissed(state.version);
  if (!show) return null;

  return (
    <div className="update-banner" role="alert">
      <span>
        发现新版本 <strong>v{state.version}</strong>（当前 v{state.currentVersion || '?'}）
      </span>
      <div className="row">
        <Button onClick={startInstall}>立即更新</Button>
        <Button variant="ghost" onClick={() => dismissUpdate(state.version)}>
          关闭
        </Button>
      </div>
    </div>
  );
}
