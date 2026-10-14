// ===== 共享高亮渲染组件 =====
// SearchTab 和 PopupApp 共用，避免重复实现。
// 按 highlights 安全渲染高亮片段：纯文本节点拼接，不用 dangerouslySetInnerHTML。
// 区间重叠/越界时按顺序切片，越界部分自动截断。

import type { SearchHighlight } from '../shared/types';

export function renderHighlighted(text: string, highlights: SearchHighlight[], field: string) {
  const ranges = highlights
    .filter((h) => h.field === field && Number.isFinite(h.start) && Number.isFinite(h.end) && h.end > h.start)
    .map((h) => ({ start: Math.max(0, Math.min(h.start, text.length)), end: Math.max(0, Math.min(h.end, text.length)) }))
    .filter((h) => h.end > h.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (ranges.length === 0 || !text) return text;

  // 合并重叠区间
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
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
