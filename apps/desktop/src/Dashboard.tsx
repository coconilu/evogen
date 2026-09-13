import { useCallback, useEffect, useState } from 'react';
import { api, eventsUrl } from './api';
import type { RunPayload, StageEvent, StatusPayload } from './types';
import { Badge, Button, Card, Empty, ErrorNote, KindBadge } from './ui';

export function Dashboard(props: { readonly onOpenProposal: (id: string) => void }) {
  const [status, setStatus] = useState<StatusPayload | undefined>();
  const [error, setError] = useState('');
  const [run, setRun] = useState<RunPayload>({ status: 'idle' });
  const [starting, setStarting] = useState(false);
  const [limit, setLimit] = useState(20);

  const refresh = useCallback(() => {
    api
      .status()
      .then((payload) => {
        setStatus(payload);
        setError('');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    api
      .currentRun()
      .then((payload) => setRun(payload))
      .catch(() => undefined);
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    let source: EventSource | undefined;
    let cancelled = false;
    eventsUrl()
      .then((url) => {
        if (cancelled) return;
        source = new EventSource(url);
        source.addEventListener('stage', (event) => {
          const data = JSON.parse((event as MessageEvent<string>).data) as StageEvent;
          setRun((previous) => ({
            ...previous,
            status: 'running',
            stages: [...(previous.stages ?? []), data],
          }));
        });
        source.addEventListener('run-done', () => {
          api
            .currentRun()
            .then((payload) => setRun(payload))
            .catch(() => undefined);
        });
        source.addEventListener('run-error', (event) => {
          const data = JSON.parse((event as MessageEvent<string>).data) as { error: string };
          setRun({ status: 'error', error: data.error });
        });
      })
      .catch(() => undefined); // SSE unavailable (browser debug without serve) — polling still works
    return () => {
      cancelled = true;
      source?.close();
    };
  }, []);

  const startRun = async () => {
    setStarting(true);
    setRun({ status: 'running', stages: [] });
    try {
      await api.startRun(limit);
      // progress arrives over SSE; poll once as a fallback
      setTimeout(() => {
        api
          .currentRun()
          .then((payload) => setRun(payload))
          .catch(() => undefined);
      }, 1500);
    } catch (err) {
      setRun({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      setStarting(false);
    }
  };

  if (error) return <ErrorNote message={`无法连接本地服务：${error}`} onRetry={refresh} />;
  if (!status) return <Empty>正在读取本机状态…</Empty>;

  const running = run.status === 'running';

  return (
    <div className="stack">
      <Card
        title="概览"
        actions={
          <div className="row">
            <label className="row-label">
              会话数
              <input
                className="input"
                type="number"
                min={1}
                max={200}
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value) || 20)}
              />
            </label>
            <Button onClick={startRun} disabled={starting || running}>
              {running ? '进化运行中…' : '运行进化（只读）'}
            </Button>
          </div>
        }
      >
        <dl className="kv">
          <dt>宿主</dt>
          <dd>{status.host}</dd>
          <dt>项目根</dt>
          <dd className="mono">{status.projectRoot}</dd>
          <dt>会话根</dt>
          <dd className="mono">{status.sessionsRoot}</dd>
          <dt>可读会话</dt>
          <dd>
            {status.sessions.files} 个（最新 {formatTime(status.sessions.newestModified)}）
          </dd>
        </dl>
      </Card>

      <Card title="可进化面">
        {status.surfaces.length === 0 ? (
          <Empty>本机未发现任何指令文件。</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>状态</th>
                <th>id</th>
                <th>类型</th>
                <th>大小</th>
                <th>路径</th>
              </tr>
            </thead>
            <tbody>
              {status.surfaces.map((surface) => (
                <tr key={surface.id}>
                  <td>{surface.exists ? <Badge tone="ok">✓</Badge> : <Badge>缺失</Badge>}</td>
                  <td className="mono">{surface.id}</td>
                  <td>{surface.kind}</td>
                  <td>{surface.exists ? `${surface.bytes} B` : '-'}</td>
                  <td className="mono path">{surface.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="进化运行">
        {run.status === 'idle' && <Empty>还没有运行过。点击「运行进化」开始一次只读分析。</Empty>}
        {run.status === 'running' && (
          <div>
            <p className="muted">正在分析会话，模型调用可能需要几分钟…</p>
            <StageList stages={run.stages ?? []} />
          </div>
        )}
        {run.status === 'error' && <ErrorNote message={run.error ?? '未知错误'} onRetry={startRun} />}
        {run.status === 'done' && (
          <div className="stack">
            {run.proposal ? (
              <>
                <p>
                  完成：产出建议 <strong>{run.proposal.title}</strong>
                  {run.proposal.expressions.length > 0
                    ? `（${run.proposal.expressions.length} 条表达式）`
                    : '（无可执行表达式）'}
                </p>
                <StageList stages={run.stages ?? []} />
                {run.surfacesUnchanged ? (
                  <p>
                    <Badge tone="ok">完整性 ✓</Badge> 运行期间所有可进化面摘要未变，没有写入任何文件。
                  </p>
                ) : (
                  <p>
                    <Badge tone="bad">完整性 ✗</Badge> 运行期间检测到文件变化，请检查。
                  </p>
                )}
                <div className="row">
                  <Button
                    variant="ghost"
                    onClick={() => run.proposal && props.onOpenProposal(run.proposal.id)}
                  >
                    查看建议详情
                  </Button>
                  <span className="muted">
                    模型用量：{run.usage?.calls ?? 0} 次调用 · 输入 {run.usage?.inputTokens ?? 0} · 输出{' '}
                    {run.usage?.outputTokens ?? 0} tokens
                  </span>
                </div>
              </>
            ) : (
              <p>
                完成：本次会话没有产生值得沉淀的建议。
                <StageList stages={run.stages ?? []} />
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function StageList(props: { readonly stages: readonly StageEvent[] }) {
  if (props.stages.length === 0) return null;
  return (
    <ul className="stage-list">
      {props.stages.map((stage, index) => (
        <li key={`${stage.name}-${index}`}>
          <KindBadge kind={stage.name} /> {stage.itemCount} 项 · {stage.durationMs} ms
        </li>
      ))}
    </ul>
  );
}

function formatTime(iso: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}
