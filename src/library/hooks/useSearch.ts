// 搜索状态与请求逻辑（App.tsx 拆分）
import { useState, useCallback, useRef, useEffect } from 'react';
import type { PageRecord, SearchResult, CaptureSource } from '../../shared/types';
import { api } from '../../ui/api';

export type SortMode = 'relevance' | 'recent' | 'frequent';

const HISTORY_PAGE_SIZE = 50;
const DEBOUNCE_MS = 300;

export function useSearch() {
  const [query, setQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [sort, setSort] = useState<SortMode>('relevance');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const historyOffsetRef = useRef(0);

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
      const fetchLimit = limit ?? HISTORY_PAGE_SIZE;
      const list = await api.listPages(0, fetchLimit);
      setPages(list);
      historyOffsetRef.current = list.length;
      setHasMore(list.length >= fetchLimit);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /** 加载更多历史记录（分页） */
  const loadMore = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const offset = historyOffsetRef.current;
      const list = await api.listPages(offset, HISTORY_PAGE_SIZE);
      setPages((prev) => [...prev, ...list]);
      historyOffsetRef.current = offset + list.length;
      setHasMore(list.length >= HISTORY_PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loading]);

  /** 删除后同步移除两处列表中的记录 */
  const removeFromLists = useCallback((pageId: string) => {
    setResults((prev) => prev.filter((r) => r.page.id !== pageId));
    setPages((prev) => prev.filter((p) => p.id !== pageId));
  }, []);

  // 域名筛选 debounce 自动搜索
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch();
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [domainFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    query, setQuery,
    domainFilter, setDomainFilter,
    sort, setSort,
    results, pages,
    loading, error, setError,
    hasMore,
    runSearch, searchWith, loadRecent, loadMore, removeFromLists,
  };
}

export type { CaptureSource };
