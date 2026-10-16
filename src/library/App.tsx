// 记录库入口：状态编排，UI 细节在 components/，异步逻辑在 hooks/
import { useState, useEffect, useRef, useMemo } from 'react';
import type { PageRecord, ImportReport } from '../shared/types';
import { api } from '../ui/api';
import { useSearch } from './hooks/useSearch';
import { useSettings } from './hooks/useSettings';
import { SearchTab } from './components/SearchTab';
import { HistoryTab } from './components/HistoryTab';
import { SettingsTab } from './components/SettingsTab';
import { PreviewModal } from './components/PreviewModal';

type Tab = 'search' | 'history' | 'settings';

/** 从 URL 参数读取初始状态（OPEN_LIBRARY 携带查询 / 设置直达，E-013/E-014） */
function readLaunchParams(): { tab: Tab; query: string } {
  try {
    const params = new URLSearchParams(location.search);
    const section = params.get('section');
    const tab: Tab = section === 'history' || section === 'settings' ? section : 'search';
    return { tab, query: params.get('q') ?? '' };
  } catch {
    return { tab: 'search', query: '' };
  }
}

export default function App() {
  const launch = useMemo(() => readLaunchParams(), []);
  const launchAppliedRef = useRef(false);
  const [tab, setTab] = useState<Tab>(launch.tab);
  const [selected, setSelected] = useState<PageRecord | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const {
    query, setQuery, domainFilter, setDomainFilter, sort, setSort,
    results, pages, loading, error, setError,
    hasMore, runSearch, searchWith, loadRecent, loadMore, removeFromLists,
  } = useSearch();

  const { settings, health, loadSettings, applySaved, applyRebuilt } = useSettings(setError);

  useEffect(() => {
    // 携带查询打开：仅首次挂载时填充搜索框并查询（E-013），避免 tab 切换时覆盖用户输入
    if (!launchAppliedRef.current) {
      launchAppliedRef.current = true;
      if (launch.query) {
        setQuery(launch.query);
        void searchWith(launch.query);
        return;
      }
    }
    if (tab === 'search') void runSearch();
    else if (tab === 'history') void loadRecent();
    else void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const flash = (message: string, ms = 2000) => {
    setStatusMessage(message);
    setTimeout(() => setStatusMessage(null), ms);
  };

  const openPage = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const removePage = async (pageId: string) => {
    try {
      await api.deletePage(pageId);
      removeFromLists(pageId);
      if (selected?.id === pageId) setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const showPreview = async (pageId: string) => {
    try {
      setSelected(await api.getPage(pageId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleImported = (report: ImportReport) => {
    flash(`导入完成：新增 ${report.inserted}，更新 ${report.updated}，跳过 ${report.skipped}${report.errors.length ? `，错误 ${report.errors.length}` : ''}`, 4000);
  };

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">ReadTrail</h1>
        <nav className="tabs">
          {(['search', 'history', 'settings'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {{ search: '搜索', history: '历史', settings: '设置' }[t]}
            </button>
          ))}
        </nav>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span>⚠ {error}</span>
          <button onClick={() => { setError(null); void runSearch(); }}>重试</button>
        </div>
      )}
      {statusMessage && <div className="status-banner" role="status">{statusMessage}</div>}

      {tab === 'search' && (
        <SearchTab
          query={query}
          setQuery={setQuery}
          domainFilter={domainFilter}
          setDomainFilter={setDomainFilter}
          sort={sort}
          setSort={setSort}
          onSearch={() => void runSearch()}
          results={results}
          loading={loading}
          onOpen={openPage}
          onPreview={showPreview}
          onDelete={removePage}
        />
      )}

      {tab === 'history' && (
        <HistoryTab
          pages={pages}
          loading={loading}
          hasMore={hasMore}
          onOpen={openPage}
          onPreview={showPreview}
          onDelete={removePage}
          onLoadMore={() => void loadMore()}
        />
      )}

      {tab === 'settings' && settings && (
        <SettingsTab
          settings={settings}
          health={health}
          onSaved={(s) => { applySaved(s); flash('设置已保存'); }}
          onRebuilt={(n) => { applyRebuilt(n); flash(`索引重建完成，共 ${n} 条`, 3000); }}
          onExported={(name) => flash(`已导出 ${name}`)}
          onImported={handleImported}
          onCleared={(n) => flash(n < 0 ? '所有数据已清空' : `已删除 ${n} 条记录`)}
          onError={setError}
        />
      )}
      {tab === 'settings' && !settings && !error && (
        <div className="empty">设置加载中…</div>
      )}
      {tab === 'settings' && !settings && error && (
        <div className="empty">设置加载失败，请点击上方「重试」</div>
      )}

      {selected && <PreviewModal page={selected} onClose={() => setSelected(null)} onOpen={openPage} />}
    </div>
  );
}
