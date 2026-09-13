import { useCallback, useState } from 'react';
import { About } from './About';
import { Dashboard } from './Dashboard';
import { History } from './History';
import { Proposals } from './Proposals';

type Page = 'dashboard' | 'proposals' | 'history' | 'about';

const NAV: ReadonlyArray<{ readonly id: Page; readonly label: string }> = [
  { id: 'dashboard', label: '仪表盘' },
  { id: 'proposals', label: '建议' },
  { id: 'history', label: '变更历史' },
  { id: 'about', label: '关于' },
];

export function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [openProposalId, setOpenProposalId] = useState<string | undefined>();

  const openProposal = useCallback((id: string) => {
    setOpenProposalId(id);
    setPage('proposals');
  }, []);
  const handleOpenHandled = useCallback(() => setOpenProposalId(undefined), []);

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-mark" />
          <span>
            Evogen <small>Studio</small>
          </span>
        </div>
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => setPage(item.id)}
          >
            {item.label}
          </button>
        ))}
        <footer className="sidebar-foot">本地运行 · 只读优先 · 写入需确认</footer>
      </nav>
      <main className="content">
        {page === 'dashboard' && <Dashboard onOpenProposal={openProposal} />}
        {page === 'proposals' && <Proposals openId={openProposalId} onOpenHandled={handleOpenHandled} />}
        {page === 'history' && <History />}
        {page === 'about' && <About />}
      </main>
    </div>
  );
}
