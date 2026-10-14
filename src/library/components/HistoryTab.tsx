// 历史标签页
import type { PageRecord } from '../../shared/types';
import { formatDate, formatDuration } from '../../ui/utils';
import { TagList } from '../../ui/TagBadge';


export function HistoryTab(props: {
  pages: PageRecord[];
  loading: boolean;
  hasMore: boolean;
  onOpen: (url: string) => void;
  onPreview: (id: string) => void;
  onDelete: (id: string) => void;
  onLoadMore: () => void;
  onTagClick?: (tag: string) => void;
}) {
  const { pages, loading, hasMore, onLoadMore } = props;
  return (
    <section className="history-section">
      <h2>最近访问</h2>
      {pages.length === 0 && !loading ? (
        <div className="empty">还没有保存过任何页面 —— 去读几篇文章吧</div>
      ) : (
        <>
          <ul className="result-list">
            {pages.map((page) => (
              <li key={page.id} className="result-item">
                <div
                  className="result-main"
                  role="button"
                  tabIndex={0}
                  aria-label={`预览 ${page.title || page.url}`}
                  onClick={() => props.onPreview(page.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && props.onPreview(page.id)}
                >
                  <div className="result-title">{page.title || page.url}</div>
                  <div className="result-meta">
                    <span className="domain">{page.domain}</span>
                    <span>{formatDate(page.lastVisitedAt)}</span>
                    <span>读过 {formatDuration(page.readingDurationMs)} · {page.visitCount} 次</span>
                  </div>
                  <TagList tags={page.tags} onClick={props.onTagClick} />
                </div>
                <div className="result-actions">
                  <button aria-label={`打开 ${page.title || page.url}`} onClick={() => props.onOpen(page.url)}>打开</button>
                  <button className="danger" aria-label={`删除 ${page.title || page.url}`} onClick={() => props.onDelete(page.id)}>删除</button>
                </div>
              </li>
            ))}
          </ul>
          {hasMore && (
            <div className="load-more">
              <button onClick={onLoadMore} disabled={loading}>
                {loading ? '加载中…' : '加载更多'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
