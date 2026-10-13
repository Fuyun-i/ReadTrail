// 详情预览 modal
import type { PageRecord } from '../../shared/types';
import { formatDate, formatDuration } from '../../ui/utils';

export function PreviewModal(props: { page: PageRecord; onClose: () => void; onOpen: (url: string) => void }) {
  const { page } = props;
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
        <article className="modal-body">{page.text.slice(0, 8000)}{page.text.length > 8000 ? '…' : ''}</article>
      </div>
    </div>
  );
}
