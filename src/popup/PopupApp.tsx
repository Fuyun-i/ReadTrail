// ReadTrail 搜索小窗口（popup）
// 职责：快速搜索已保存网页、显示记录状态、跳转记录库/设置。
// 不做数据管理；查询通过 OPEN_LIBRARY 消息携带到记录库。

import { useState, useEffect, useRef, useCallback } from 'react';
import type { SearchResult, SearchHighlight } from '../shared/types';
import { api } from '../ui/api';
import { formatDate } from '../ui/utils';

const POPUP_RESULT_LIMIT = 8; // 小窗口只显示少量结果（product-design 3.2）

export default function PopupApp() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null); // 记录状态
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开即聚焦搜索框（E-011）
  useEffect(() => {
    inputRef.current?.focus();
    void api.getSettings()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(null));
    // 空查询：展示少量最近保存
    void loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRecent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResults(await api.search({ query: '', limit: POPUP_RESULT_LIMIT }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const runSearch = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      setResults(await api.search({ query: q.trim(), limit: POPUP_RESULT_LIMIT }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const openLibrary = async (carryQuery: boolean) => {
    try {
      // 等消息送达再关窗：popup 关闭会终止未完成的消息发送
      await chrome.runtime.sendMessage({
        type: 'OPEN_LIBRARY',
        payload: { query: carryQuery ? query.trim() : '', section: carryQuery ? 'search' : 'settings' },
      });
    } finally {
      window.close();
    }
  };

  const openOriginal = (url: string) => {
    window.open(url, '_blank');
  };

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">ReadTrail</h1>
        <span className={`status ${enabled === false ? 'paused' : ''}`} role="status">
          <span className="dot" aria-hidden="true" />
          {enabled === null ? '状态未知' : enabled ? '记录中' : '已暂停'}
        </span>
      </header>

      <div className="search-bar">
        <input
          ref={inputRef}
          className="search-input"
          placeholder="搜索读过的网页…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void runSearch(query)}
          aria-label="搜索已保存网页"
        />
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span>⚠ {error}</span>
          <button onClick={() => void (query.trim() ? runSearch(query) : loadRecent())}>重试</button>
        </div>
      )}

      {results.length === 0 && !loading ? (
        <div className="empty">
          {searched
            ? '没有匹配的记录'
            : '还没有保存过的网页。\n正常阅读文章 10 秒以上并滚动，就会自动记录到这里。'}
        </div>
      ) : (
        <ul className="result-list">
          {results.map(({ page, highlights }) => (
            <li
              key={page.id}
              className="result-item"
              role="button"
              tabIndex={0}
              aria-label={`打开 ${page.title || page.url}`}
              onClick={() => openOriginal(page.url)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openOriginal(page.url)}
            >
              <div className="result-title">{renderHighlighted(page.title, highlights, 'title')}</div>
              <div className="result-meta">
                <span className="domain">{page.domain}</span>
                <span>{formatDate(page.lastVisitedAt)}</span>
              </div>
              {page.excerpt && <div className="result-excerpt">{renderHighlighted(page.excerpt, highlights, 'excerpt')}</div>}
            </li>
          ))}
        </ul>
      )}

      <footer className="footer">
        <button className="primary" onClick={() => void openLibrary(true)}>打开记录库</button>
        <button onClick={() => void openLibrary(false)}>设置</button>
      </footer>
    </div>
  );
}

/** 与记录库一致的安全高亮渲染 */
function renderHighlighted(text: string, highlights: SearchHighlight[], field: string) {
  const ranges = highlights
    .filter((h) => h.field === field && Number.isFinite(h.start) && Number.isFinite(h.end) && h.end > h.start)
    .map((h) => ({ start: Math.max(0, Math.min(h.start, text.length)), end: Math.max(0, Math.min(h.end, text.length)) }))
    .filter((h) => h.end > h.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (ranges.length === 0 || !text) return text;

  const merged: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }

  const nodes: Array<string | JSX.Element> = [];
  let cursor = 0;
  merged.forEach((r, i) => {
    if (r.start > cursor) nodes.push(text.slice(cursor, r.start));
    nodes.push(<mark key={`h${i}`}>{text.slice(r.start, r.end)}</mark>);
    cursor = r.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
