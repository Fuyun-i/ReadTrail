// 搜索状态与请求逻辑（App.tsx 拆分）
import { useState, useCallback } from 'react';
import type { PageRecord, SearchResult, CaptureSource } from '../../shared/types';
import { api } from '../../ui/api';

export type SortMode = 'relevance' | 'recent' | 'frequent';

export function useSearch() {
  const [query, setQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [sort, setSort] = useState<SortMode>('relevance');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 以指定关键词执行搜索（记录库携带查询打开时使用） */
  const searchWith = useCallback(async (q: string, limit?: number) => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.search({
        query: q.trim(),
        domain: domainFilter.trim() || undefined,
        sort,
        limit,
      });
      setResults(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults((prev) => prev); // 查询失败不清空已有结果
    } finally {
      setLoading(false);
    }
  }, [domainFilter, sort]);

  const runSearch = useCallback(async (limit?: number) => {
    await searchWith(query, limit);
  }, [query, searchWith]);

  const loadRecent = useCallback(async (limit?: number) => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listPages(0, limit ?? 50);
      setPages(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /** 删除后同步移除两处列表中的记录 */
  const removeFromLists = useCallback((pageId: string) => {
    setResults((prev) => prev.filter((r) => r.page.id !== pageId));
    setPages((prev) => prev.filter((p) => p.id !== pageId));
  }, []);

  return {
    query, setQuery,
    domainFilter, setDomainFilter,
    sort, setSort,
    results, pages,
    loading, error, setError,
    runSearch, searchWith, loadRecent, removeFromLists,
  };
}

export type { CaptureSource };
