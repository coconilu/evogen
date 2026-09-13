import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { ApplyReport, Preview, Proposal } from './types';
import { Badge, Button, Card, Empty, ErrorNote, KindBadge, Modal } from './ui';

const STATUS_LABEL: Record<string, string> = {
  draft: '待审',
  approved: '已批准',
  rejected: '已拒绝',
  applied: '已写入',
  partially_applied: '部分写入',
};

export function Proposals(props: {
  readonly openId: string | undefined;
  readonly onOpenHandled: () => void;
}) {
  const [proposals, setProposals] = useState<readonly Proposal[]>();
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<{ proposal: Proposal; previews: readonly Preview[] } | undefined>();

  const refresh = useCallback(() => {
    api
      .proposals()
      .then((payload) => {
        setProposals(payload.proposals);
        setError('');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (!props.openId) return;
    api
      .proposal(props.openId)
      .then(setDetail)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(props.onOpenHandled);
  }, [props.openId, props.onOpenHandled]);

  const refreshDetail = useCallback(
    (id: string) =>
      api
        .proposal(id)
        .then(setDetail)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))),
    [],
  );

  if (error) return <ErrorNote message={error} onRetry={refresh} />;
  if (!proposals) return <Empty>正在读取建议…</Empty>;
  if (proposals.length === 0) {
    return (
      <Empty>
        还没有保存的建议。在仪表盘运行一次进化（或用 evogen proposals --save）后，建议会出现在这里。
      </Empty>
    );
  }

  return (
    <div className="stack">
      {proposals.map((proposal) => (
        <Card
          key={proposal.id}
          title={proposal.title}
          actions={
            <div className="row">
              {proposal.status === 'draft' && <StatusBadge status={proposal.status} />}
              {proposal.status !== 'draft' && <StatusBadge status={proposal.status} />}
              <Button
                variant="ghost"
                onClick={() =>
                  api
                    .proposal(proposal.id)
                    .then(setDetail)
                    .catch(() => undefined)
                }
              >
                查看详情
              </Button>
            </div>
          }
        >
          <p className="muted">
            {STATUS_LABEL[proposal.status] ?? proposal.status} · {proposal.id} ·{' '}
            {new Date(proposal.createdAt).toLocaleString()} · {proposal.signals.length} 个信号
            {proposal.critique
              ? ` · 风险 ${proposal.critique.risk.toFixed(2)} / 置信 ${proposal.critique.confidence.toFixed(2)}`
              : ''}
          </p>
          {proposal.critique?.notes && <p className="muted">{proposal.critique.notes}</p>}
        </Card>
      ))}

      <Modal
        open={detail !== undefined}
        onClose={() => setDetail(undefined)}
        title={detail ? detail.proposal.title : ''}
      >
        {detail && (
          <ProposalDetail
            {...detail}
            onChanged={(id) => {
              refresh();
              refreshDetail(id);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

export function StatusBadge(props: { readonly status: string }) {
  const tone =
    props.status === 'applied'
      ? 'ok'
      : props.status === 'approved' || props.status === 'partially_applied'
        ? 'warn'
        : props.status === 'rejected'
          ? 'bad'
          : 'muted';
  return <Badge tone={tone}>{STATUS_LABEL[props.status] ?? props.status}</Badge>;
}

function ProposalDetail(props: {
  readonly proposal: Proposal;
  readonly previews: readonly Preview[];
  readonly onChanged: (id: string) => void;
}) {
  const { proposal, previews } = props;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [confirming, setConfirming] = useState<'approve' | 'apply' | 'revertless' | undefined>(undefined);
  const [report, setReport] = useState<ApplyReport | undefined>();

  const act = async (action: 'approve' | 'reject' | 'apply') => {
    setBusy(true);
    setActionError('');
    try {
      if (action === 'apply') {
        const result = await api.applyProposal(proposal.id);
        setReport(result);
      } else {
        await api.setProposalStatus(proposal.id, action);
        setReport(undefined);
      }
      setConfirming(undefined);
      props.onChanged(proposal.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <StatusBadge status={proposal.status} />
        {proposal.status === 'draft' && (
          <>
            <Button onClick={() => setConfirming('approve')} disabled={busy}>
              批准
            </Button>
            <Button variant="ghost" onClick={() => act('reject')} disabled={busy}>
              拒绝
            </Button>
          </>
        )}
        {proposal.status === 'approved' && (
          <Button onClick={() => setConfirming('apply')} disabled={busy}>
            应用写入（{proposal.expressions.length} 处）
          </Button>
        )}
      </div>

      {actionError && <ErrorNote message={actionError} />}

      {confirming && (
        <div className="confirm-box">
          {confirming === 'approve' ? (
            <p>批准只是标记状态，不会写文件；写入还需在批准后再次确认。确认批准这条建议？</p>
          ) : (
            <p>
              将向 {new Set(proposal.expressions.map((e) => e.surfaceId)).size} 个指令文件追加{' '}
              {proposal.expressions.length} 个带标记的块。写入内容可按变更记录精确撤销。确认写入？
            </p>
          )}
          <div className="row">
            <Button onClick={() => act(confirming === 'approve' ? 'approve' : 'apply')} disabled={busy}>
              {confirming === 'approve' ? '确认批准' : '确认写入'}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(undefined)} disabled={busy}>
              取消
            </Button>
          </div>
        </div>
      )}

      {report && (
        <div className="evidence">
          <h3>写入结果</h3>
          <ul>
            {report.records.map((record) => (
              <li key={record.changeId}>
                ✓ {record.changeId} → {record.path}（digest {record.beforeDigest.slice(0, 8)}… →{' '}
                {record.afterDigest.slice(0, 8)}…）
              </li>
            ))}
            {report.failures.map((failure) => (
              <li key={failure.expressionId}>
                ✗ {failure.expressionId}: {failure.reason}
              </li>
            ))}
          </ul>
          <p className="muted">可在「变更历史」页按 changeId 精确撤销。</p>
        </div>
      )}

      {proposal.critique && (
        <p>
          <Badge tone={proposal.critique.risk > 0.6 ? 'bad' : proposal.critique.risk > 0.3 ? 'warn' : 'ok'}>
            风险 {proposal.critique.risk.toFixed(2)}
          </Badge>{' '}
          <Badge tone={proposal.critique.confidence > 0.6 ? 'ok' : 'warn'}>
            置信 {proposal.critique.confidence.toFixed(2)}
          </Badge>{' '}
          {proposal.critique.notes}
        </p>
      )}

      {proposal.expressions.length === 0 && <Empty>这条建议没有可执行的表达式。</Empty>}

      {proposal.expressions.map((expression) => {
        const preview = previews.find((item) => item.expressionId === expression.id);
        return (
          <section key={expression.id} className="expression">
            <header className="expression-head">
              <KindBadge kind={expression.op} />
              <span className="mono">{expression.surfaceId}</span>
              {preview && <span className="mono path">{preview.path}</span>}
            </header>
            {expression.rationale && <p className="muted">{expression.rationale}</p>}
            <pre className="content">{expression.payload.content}</pre>
            {preview?.diff && <pre className="diff">{preview.diff}</pre>}
            <EvidenceList evidenceIds={expression.evidenceIds} signals={proposal.signals} />
          </section>
        );
      })}
    </div>
  );
}

function EvidenceList(props: {
  readonly evidenceIds: readonly string[];
  readonly signals: readonly {
    readonly id: string;
    readonly statement: string;
    readonly evidenceIds: readonly string[];
  }[];
}) {
  const statements = props.signals.filter((signal) =>
    signal.evidenceIds.some((id) => props.evidenceIds.includes(id)),
  );
  if (statements.length === 0) return null;
  return (
    <div className="evidence">
      <h3>证据来源</h3>
      <ul>
        {statements.map((signal) => (
          <li key={signal.id}>
            <KindBadge kind={signal.id.split('_')[0] ?? 'signal'} /> {signal.statement}（
            {signal.evidenceIds.length} 条会话证据）
          </li>
        ))}
      </ul>
    </div>
  );
}
