import { Empty } from './ui';

/**
 * Change history is populated in M2 (apply/revert). The store already keeps
 * ChangeRecords; the API gains its endpoint together with the write loop.
 */
export function History() {
  return <Empty>变更历史在 M2（写入闭环）上线后展示：每次写入的标记块、前后摘要、以及撤销入口。</Empty>;
}
