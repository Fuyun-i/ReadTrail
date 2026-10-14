// 搜索标签页
import type { SearchResult } from '../../shared/types';
import { formatDate, formatDuration } from '../../ui/utils';
import { renderHighlighted } from '../../ui/highlight';
import { TagList } from '../../ui/TagBadge';
import type { SortMode } from '../hooks/useSearch';

export function SearchTab(props: {
  query: string;
  setQuery: (v: string) => void;
  domainFilter: string;
  setDomainFilter: (v: string) => void;
  sort: SortMode;
  setSort: (v: SortMode) => void;
  onSearch: () => void;
  results: SearchResult[];
  loading: boolean;
  onOpen: (url: string) => void;
  onPreview: (id: string) => void;
  onDelete: (id: string) => void;
  onTagClick?: (tag: string) => void;
}) {
  const { query, setQuery, domainFilter, setDomainFilter, sort, setSort, onSearch, results, loading } = props;

  return (
    <section className="search-section">
      <div className="search-bar">
        <input
          className="search-input"
          autoFocus
          placeholder="搜索标题、正文、域名…（支持 tag:rust / domain:github.com / 昨天看过）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
        />
        <button className="btn primary" onClick={onSearch} disabled={loading}>
          {loading ? '搜索中…' : '搜索'}
        </button>
      </div>
      <div className="filters">
        <input
          className="filter-input"
          placeholder="域名筛选，如 github.com"
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
          <option value="relevance">相关度</option>
          <option value="recent">最近访问</option>
          <option value="frequent">访问次数</option>
        </select>
      </div>

      {results.length === 0 && !loading ? (
        <div className="empty">没有匹配的记录</div>
      ) : (
        <ul className="result-list">
          {results.map(({ page, highlights }) => (
            <li key={page.id} className="result-item">
              <div
                className="result-main"
                role="button"
                tabIndex={0}
                aria-label={`预览 ${page.title || page.url}`}
                onClick={() => props.onPreview(page.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && props.onPreview(page.id)}
              >
                <div className="result-title">{renderHighlighted(page.title, highlights, 'title')}</div>
                <div className="result-meta">
                  <span className="domain">{page.domain}</span>
                  <span>{formatDate(page.lastVisitedAt)}</span>
                  <span>读过 {formatDuration(page.readingDurationMs)} · {page.visitCount} 次</span>
                </div>
                {page.excerpt && <div className="result-excerpt">{renderHighlighted(page.excerpt, highlights, 'excerpt')}</div>}
                <TagList tags={page.tags} onClick={props.onTagClick} />
              </div>
              <div className="result-actions">
                <button aria-label={`打开 ${page.title || page.url}`} onClick={() => props.onOpen(page.url)}>打开</button>
                <button className="danger" aria-label={`删除 ${page.title || page.url}`} onClick={() => props.onDelete(page.id)}>删除</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
