// 设置加载与索引健康状态（App.tsx 拆分）
import { useState, useCallback } from 'react';
import type { UserSettings, SearchHealth } from '../../shared/types';
import { api } from '../../ui/api';

export function useSettings(onError: (msg: string) => void) {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [health, setHealth] = useState<SearchHealth | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([api.getSettings(), api.indexHealth()]);
      setSettings(s);
      setHealth(h);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [onError]);

  const applySaved = useCallback((s: UserSettings) => setSettings(s), []);
  const applyRebuilt = useCallback((count: number) => {
    setHealth((h) => (h ? { ...h, needsRebuild: false, indexedCount: count } : h));
  }, []);

  return { settings, health, loadSettings, applySaved, applyRebuilt };
}
