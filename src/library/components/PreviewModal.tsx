// 详情预览 modal
import { useState } from 'react';
import type { PageRecord } from '../../shared/types';
import { formatDate, formatDuration } from '../../ui/utils';

const PREVIEW_LIMIT = 8000;

export function PreviewModal(props: { page: PageRecord; onClose: () => void; onOpen: (url: string) => void }) {
  const { page } = props;
  const [expanded, setExpanded] = useState(false);
  const isLong = page.text.length > PREVIEW_LIMIT;
  const displayText = expanded ? page.text : page.text.slice(0, PREVIEW_LIMIT);

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
