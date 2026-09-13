import { useCallback, useEffect, useState } from 'react';
import { api, eventsUrl } from './api';
import type { RunPayload, StageEvent, StatusPayload } from './types';
import { Badge, Button, Card, Empty, ErrorNote, KindBadge } from './ui';

const STAGE_LABEL: Record<string, string> = {
  collect: '收集',
  distill: '提炼',
  aggregate: '归并',
  propose: '提议',
  critique: '自检',
};

export function Dashboard(props: {
  readonly onOpenProposal: (id: string) => void;
  readonly onOpenSettings: () => void;
}) {
  const [status, setStatus] = useState<StatusPayload | undefined>();
  const [error, setError] = useState('');
  const [run, setRun] = useState<RunPayload>({ status: 'idle' });
  const [starting, setStarting] = useState(false);
  const [limit, setLimit] = useState(20);
  const [pendingCount, setPendingCount] = useState<number>();
  const [appliedCount, setAppliedCount] = useState<number>();
  const [revertedCount, setRevertedCount] = useState<number>();

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
    api
      .proposals()
      .then(({ proposals }) =>
        setPendingCount(proposals.filter((p) => p.status === 'draft' || p.status === 'approved').length),
      )
      .catch(() => undefined);
    api
      .changes()
      .then((payload) => {
        setAppliedCount(payload.changes.length);
        setRevertedCount(payload.reverted.length);
      })
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
          refresh();
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
  }, [refresh]);

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

  const needsModelConfig = /尚未配置模型/.test(run.error ?? '');

  return (
    <div className="stack">
      <LoopStrip
        sessions={status?.sessions.files}
        surfaces={status?.surfaces.length}
        stages={run.stages}
        pending={pendingCount}
        applied={appliedCount}
        reverted={revertedCount}
      />

      {needsModelConfig && (
        <Card title="先配置模型">
          <p>还没有可用的模型端点。到「设置」页填写接口地址、API Key 和模型 ID 即可开始。</p>
          <Button onClick={props.onOpenSettings}>去设置</Button>
        </Card>
      )}

      <Card
        title="发起一次进化（只读）"
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
            <Button onClick={startRun} disabled={starting || run.status === 'running'}>
              {run.status === 'running' ? '进化运行中…' : '运行进化'}
            </Button>
          </div>
        }
      >
        {error ? (
          <ErrorNote message={`无法连接本地服务：${error}`} onRetry={refresh} />
        ) : !status ? (
          <Empty>正在读取本机状态…</Empty>
        ) : (
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
        )}
      </Card>

      <Card title="可进化面">
        {!status || status.surfaces.length === 0 ? (
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

      <Card title="上次运行">
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

/** 收集 → 整理 → 建议 → 消费：把进化环路摆在最显眼的位置。 */
function LoopStrip(props: {
  readonly sessions?: number;
  readonly surfaces?: number;
  readonly stages?: readonly StageEvent[];
  readonly pending?: number;
  readonly applied?: number;
  readonly reverted?: number;
}) {
  const stage = (name: string): StageEvent | undefined => props.stages?.find((s) => s.name === name);
  const collect = stage('collect');
  const distill = stage('distill');
  const aggregate = stage('aggregate');
  const nodes = [
    {
      key: 'collect',
      title: '收集',
      hint: '读取宿主会话日志',
      main: props.sessions === undefined ? '…' : `${props.sessions} 个会话`,
      sub: props.surfaces === undefined ? '' : `${props.surfaces} 个可进化面`,
      active: Boolean(collect),
    },
    {
      key: 'organize',
      title: '整理',
      hint: '提炼证据并归并成信号',
      main: distill ? `${distill.itemCount} 条证据` : '未运行',
      sub: aggregate ? `归并为 ${aggregate.itemCount} 个信号` : ' ',
      active: Boolean(distill || aggregate),
    },
    {
      key: 'propose',
      title: '建议',
      hint: '生成可评审的指令改动',
      main: props.pending === undefined ? '…' : `${props.pending} 条待处理`,
      sub: ' ',
      active: props.stages?.some((s) => s.name === 'propose' || s.name === 'critique') ?? false,
    },
    {
      key: 'consume',
      title: '消费',
      hint: '确认后写入指令文件',
      main: props.applied === undefined ? '…' : `${props.applied} 笔写入`,
      sub: props.reverted === undefined ? '' : `${props.reverted} 笔已撤销`,
      active: false,
    },
  ];
  return (
    <Card title="进化环路">
      <div className="loop">
        {nodes.map((node, index) => (
          <div key={node.key} className={`loop-node ${node.active ? 'active' : ''}`}>
            <div className="loop-title">
              {index + 1}. {node.title}
            </div>
            <div className="loop-main">{node.main}</div>
            <div className="loop-sub">{node.sub || node.hint}</div>
          </div>
        ))}
      </div>
      <p className="muted">
        会话里的纠正与偏好被收集、整理成建议；你确认后写入指令文件，后续会话直接受益——环就转起来了。
      </p>
    </Card>
  );
}

function StageList(props: { readonly stages: readonly StageEvent[] }) {
  if (props.stages.length === 0) return null;
  return (
    <ul className="stage-list">
      {props.stages.map((stage, index) => (
        <li key={`${stage.name}-${index}`}>
          <KindBadge kind={STAGE_LABEL[stage.name] ?? stage.name} /> {stage.itemCount} 项 · {stage.durationMs}{' '}
          ms
        </li>
      ))}
    </ul>
  );
}

function formatTime(iso: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}
