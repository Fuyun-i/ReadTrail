// 设置标签页（含数据管理与索引状态）
import { useState, useEffect } from 'react';
import type { UserSettings, SearchHealth, ImportReport } from '../../shared/types';
import { api, downloadBase64 } from '../../ui/api';

export function SettingsTab(props: {
  settings: UserSettings;
  health: SearchHealth | null;
  onSaved: (s: UserSettings) => void;
  onRebuilt: (n: number) => void;
  onExported: (name: string) => void;
  onImported: (r: ImportReport) => void;
  onCleared: () => void;
  onError: (msg: string) => void;
}) {
  const { settings, health } = props;
  const [enabled, setEnabled] = useState(settings.enabled);
  const [minSeconds, setMinSeconds] = useState(Math.round(settings.minReadingDurationMs / 1000));
  const [minScroll, setMinScroll] = useState(Math.round(settings.minScrollRatio * 100));
  const [minTextLength, setMinTextLength] = useState(settings.minTextLength);
  const [retentionDays, setRetentionDays] = useState(settings.retentionDays);
  const [searchResultLimit, setSearchResultLimit] = useState(settings.searchResultLimit);
  const [excluded, setExcluded] = useState(settings.excludedDomains.join(', '));
  const [included, setIncluded] = useState(settings.includedDomains.join(', '));
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false); // 防止重复点击触发并发导入/重建/删除

  // M-5: 外部 settings 变更时同步本地状态（如其他标签页修改了设置）
  useEffect(() => {
    setEnabled(settings.enabled);
    setMinSeconds(Math.round(settings.minReadingDurationMs / 1000));
    setMinScroll(Math.round(settings.minScrollRatio * 100));
    setMinTextLength(settings.minTextLength);
    setRetentionDays(settings.retentionDays);
    setSearchResultLimit(settings.searchResultLimit);
    setExcluded(settings.excludedDomains.join(', '));
    setIncluded(settings.includedDomains.join(', '));
  }, [settings]);

  const guard = <A extends unknown[]>(fn: (...args: A) => Promise<void>) => (...args: A) => {
    if (busy) return Promise.resolve();
    setBusy(true);
    return fn(...args).finally(() => setBusy(false));
  };

  const save = guard(async () => {
    try {
      const { settings: updated } = await api.updateSettings({
        enabled,
        minReadingDurationMs: minSeconds * 1000,
        minScrollRatio: minScroll / 100,
        minTextLength,
        // H-3: retentionDays=0 表示永久保留，提交 undefined 而非 0
        retentionDays: retentionDays && retentionDays > 0 ? retentionDays : undefined,
        searchResultLimit,
        excludedDomains: excluded.split(/[,，\s]+/).filter(Boolean),
        includedDomains: included.split(/[,，\s]+/).filter(Boolean),
      });
      props.onSaved(updated);
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err));
    }
  });

  const rebuild = guard(async () => {
    try {
      const { rebuilt } = await api.rebuildIndex();
      props.onRebuilt(rebuilt);
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err));
    }
  });

  const exportJson = guard(async () => {
    try {
      const { base64 } = await api.exportJson();
      downloadBase64(base64, `readtrail-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      props.onExported('JSON 备份');
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err));
    }
  });

  const exportMarkdown = guard(async () => {
    try {
      const { base64 } = await api.exportMarkdown();
      downloadBase64(base64, `readtrail-export-${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown');
      props.onExported('Markdown');
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err));
    }
  });

  const importFile = guard(async (file: File) => {
    try {
      const text = await file.text();
      const report = await api.importJson(text, importMode);
      props.onImported(report);
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err));
    }
  });

  const clearAll = guard(async () => {
    if (!window.confirm('确定删除所有已保存的页面、正文和访问记录？此操作不可恢复。')) return;
    try {
      await api.clearAll();
      props.onCleared();
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err));
    }
  });

  return (
    <section className="settings-section">
      <h2>采集设置</h2>
      <label className="row">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        启用自动采集
      </label>
      <label className="row">
        最少阅读时长（秒）
        <input type="number" min={0} value={minSeconds} onChange={(e) => setMinSeconds(Number(e.target.value))} />
      </label>
      <label className="row">
        最少滚动比例（%）
        <input type="number" min={0} max={100} value={minScroll} onChange={(e) => setMinScroll(Number(e.target.value))} />
      </label>
      <label className="row">
        最少正文长度（字符）
        <input type="number" min={0} step={100} value={minTextLength} onChange={(e) => setMinTextLength(Number(e.target.value))} />
      </label>
      <label className="row">
        数据保留天数（0 或留空 = 永久保留）
        <input type="number" min={0} step={1} value={retentionDays ?? 0} onChange={(e) => setRetentionDays(Number(e.target.value) || undefined)} />
      </label>
      <label className="row">
        搜索结果上限
        <input type="number" min={1} step={1} value={searchResultLimit} onChange={(e) => setSearchResultLimit(Number(e.target.value))} />
      </label>
      <label className="row">
        排除域名（逗号分隔）
        <input value={excluded} onChange={(e) => setExcluded(e.target.value)} placeholder="example.com, bank.example" />
      </label>
      <label className="row">
        允许域名（覆盖排除规则）
        <input value={included} onChange={(e) => setIncluded(e.target.value)} placeholder="news.example.com" />
      </label>
      <button className="btn primary" onClick={save} disabled={busy}>保存设置</button>

      <h2>索引状态</h2>
      {health && (
        <div className="health">
          <span>索引 {health.indexedCount} / 数据库 {health.databaseCount} 条</span>
          {health.needsRebuild && <span className="warn">⚠ 索引需要重建</span>}
        </div>
      )}
      <button onClick={rebuild} disabled={busy}>{busy ? '处理中…' : '重建索引'}</button>

      <h2>数据管理</h2>
      <div className="data-actions">
        <button onClick={exportJson} disabled={busy}>导出 JSON</button>
        <button onClick={exportMarkdown} disabled={busy}>导出 Markdown</button>
        <select value={importMode} onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}>
          <option value="merge">合并导入</option>
          <option value="replace">替换导入</option>
        </select>
        <label className="file-btn">
          导入 JSON
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])}
          />
        </label>
        <button className="danger" onClick={clearAll} disabled={busy}>清空全部数据</button>
      </div>
      <p className="privacy-note">所有数据仅保存在本机浏览器中，本扩展不向任何远程服务发送你的正文。</p>
    </section>
  );
}
