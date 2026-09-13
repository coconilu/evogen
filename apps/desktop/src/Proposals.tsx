import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Preview, Proposal } from './types';
import { Badge, Button, Card, Empty, ErrorNote, KindBadge, Modal } from './ui';

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
          }
        >
          <p className="muted">
            <Badge>{proposal.status}</Badge> {proposal.id} · {new Date(proposal.createdAt).toLocaleString()} ·{' '}
            {proposal.signals.length} 个信号
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
        {detail && <ProposalDetail {...detail} />}
      </Modal>
    </div>
  );
}

function ProposalDetail(props: { readonly proposal: Proposal; readonly previews: readonly Preview[] }) {
  const { proposal, previews } = props;
  return (
    <div className="stack">
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
      <p className="muted">M2 起可从每条证据点回原始会话片段。</p>
    </div>
  );
}
