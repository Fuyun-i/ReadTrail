// 详情预览 modal
import { useState, useCallback, useEffect } from 'react';
import type { SearchResult } from '../../shared/types';
import type { PageRecord } from '../../shared/types';
import { formatDate, formatDuration } from '../../ui/utils';
import { TagList } from '../../ui/TagBadge';
import { api } from '../../ui/api';

const PREVIEW_LIMIT = 8000;

export function PreviewModal(props: { page: PageRecord; onClose: () => void; onOpen: (url: string) => void; onPageUpdated?: (page: PageRecord) => void }) {
  const { page } = props;
  const [expanded, setExpanded] = useState(false);
  const [tags, setTags] = useState<string[]>(page.tags ?? []);
  const [newTag, setNewTag] = useState('');
  const [related, setRelated] = useState<SearchResult[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const isLong = page.text.length > PREVIEW_LIMIT;
  const displayText = expanded ? page.text : page.text.slice(0, PREVIEW_LIMIT);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRelatedLoading(true);
      try {
        const results = await api.getRelated(page.id);
        if (!cancelled) setRelated(results);
      } catch {
        // 忽略
      } finally {
        if (!cancelled) setRelatedLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page.id]);

  const addTag = useCallback(async () => {
    const trimmed = newTag.trim().toLowerCase();
    if (!trimmed || tags.includes(trimmed)) return;
    const updatedTags = [...tags, trimmed];
    setTags(updatedTags);
    setNewTag('');
    try {
      const result = await api.updateTags(page.id, updatedTags);
      props.onPageUpdated?.(result.page);
    } catch {
      // 回滚
      setTags(tags);
    }
  }, [newTag, tags, page.id, props]);

  const removeTag = useCallback(async (tag: string) => {
    const updatedTags = tags.filter((t) => t !== tag);
    setTags(updatedTags);
    try {
      const result = await api.updateTags(page.id, updatedTags);
      props.onPageUpdated?.(result.page);
    } catch {
      // 回滚
      setTags(tags);
    }
  }, [tags, page.id, props]);

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>{page.title || page.url}</h2>
          <button onClick={props.onClose}>关闭</button>
        </header>
        <div className="modal-meta">
          <a href={page.url} target="_blank" rel="noreferrer">{page.url}</a>
          <span>{formatDate(page.lastVisitedAt)} · 访问 {page.visitCount} 次 · 阅读 {formatDuration(page.readingDurationMs)}</span>
        </div>
        <div className="modal-tags">
          <TagList tags={tags} onRemove={removeTag} />
          <div className="tag-add">
            <input
              className="tag-input"
              placeholder="添加标签…"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
            />
            <button onClick={addTag} disabled={!newTag.trim()}>添加</button>
          </div>
        </div>
        {related.length > 0 && (
          <div className="modal-related">
            <h3>相关文章</h3>
            <ul>
              {related.map(({ page: p }) => (
                <li key={p.id} className="related-item" onClick={() => props.onOpen(p.url)}>
                  <span className="related-title">{p.title || p.url}</span>
                  <span className="related-domain">{p.domain}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <article className="modal-body">
          {displayText}
          {isLong && !expanded && '…'}
        </article>
        {isLong && (
          <div className="modal-footer">
            <button onClick={() => setExpanded(!expanded)}>
              {expanded ? '收起全文' : '展开全文'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
