// 标签管理面板 — 展示所有标签及使用计数，点击标签可筛选
import { useState, useEffect, useCallback } from 'react';
import { api } from '../../ui/api';
import type { PageRecord } from '../../shared/types';
import { TagBadge } from '../../ui/TagBadge';

export function TagManager(props: {
  onTagClick?: (tag: string) => void;
}) {
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getTags();
      setTags(result);
    } catch {
      // 忽略错误
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="tag-manager-section">
      <h2>标签管理</h2>
      {loading ? (
        <div className="empty">加载中…</div>
      ) : tags.length === 0 ? (
        <div className="empty">还没有标签 —— 在搜索结果或历史记录中为页面添加标签吧</div>
      ) : (
        <div className="tag-cloud">
          {tags.map(({ tag, count }) => (
            <button
              key={tag}
              className="tag-cloud-item"
              onClick={() => props.onTagClick?.(tag)}
              title={`${tag} (${count} 篇文章）`}
            >
              <TagBadge tag={tag} />
              <span className="tag-count">{count}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
