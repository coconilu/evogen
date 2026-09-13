import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { ChangesPayload } from './types';
import { Badge, Button, Card, Empty, ErrorNote } from './ui';

export function History() {
  const [payload, setPayload] = useState<ChangesPayload>();
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [confirmId, setConfirmId] = useState('');

  const refresh = useCallback(() => {
    api
      .changes()
      .then((next) => {
        setPayload(next);
        setError('');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(refresh, [refresh]);

  const revert = async (changeId: string) => {
    setBusyId(changeId);
    try {
      await api.revertChange(changeId);
      setConfirmId('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId('');
    }
  };

  if (error && !payload) return <ErrorNote message={error} onRetry={refresh} />;
  if (!payload) return <Empty>正在读取变更历史…</Empty>;
  if (payload.changes.length === 0) {
    return (
      <Empty>还没有写入过任何变更。批准并应用一条建议后，这里会列出每个标记块的写入记录与撤销入口。</Empty>
    );
  }

  return (
    <div className="stack">
      {error && <ErrorNote message={error} onRetry={refresh} />}
      {[...payload.changes].reverse().map((change) => {
        const reverted = payload.reverted.includes(change.changeId);
        return (
          <Card
            key={change.changeId}
            title={change.changeId}
            actions={
              reverted ? (
                <Badge>已撤销</Badge>
              ) : confirmId === change.changeId ? (
                <div className="row">
                  <Button onClick={() => revert(change.changeId)} disabled={busyId === change.changeId}>
                    确认撤销
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmId('')}
                    disabled={busyId === change.changeId}
                  >
                    取消
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmId(change.changeId)}>
                  撤销
                </Button>
              )
            }
          >
            <p className="muted">
              {change.surfaceId} · {change.op} · {new Date(change.appliedAt).toLocaleString()}
            </p>
            <p className="mono path">{change.path}</p>
            <p className="muted mono">
              digest {change.beforeDigest} → {change.afterDigest}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
