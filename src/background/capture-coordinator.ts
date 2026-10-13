// ===== 采集协调器（architecture.md 第 2.1 / 12 节）=====
// 职责：将阅读候选转换为 saved / skipped / failed，并同步数据库与索引。

import type { CaptureCandidate, PageRecord, VisitRecord, CaptureSource } from '../shared/types';
import type { PrivacyPolicy, PrivacyInput } from './privacy-policy';
import type { PageRepository } from '../storage/repositories/page-repository';
import type { VisitRepository } from '../storage/repositories/visit-repository';
import type { SettingsRepository } from '../storage/repositories/settings-repository';
import type { SearchProvider } from '../search/search-provider';
import { canonicalizeUrl, extractDomain } from '../shared/url';
import { makeVisitId } from '../storage/repositories/visit-repository';

export type CaptureOutcome =
  | { status: 'captured'; pageId: string; record: PageRecord }
  | { status: 'skipped'; reason: string; matchedRule?: string }
  | { status: 'failed'; message: string };

const MAX_TEXT_LENGTH = 500_000; // 正文大小上限，超出截断（协议要求）

export class CaptureCoordinator {
  constructor(
    private privacy: PrivacyPolicy,
    private pages: PageRepository,
    private visits: VisitRepository,
    private settingsRepo: SettingsRepository,
    private search: SearchProvider,
    private now: () => number = Date.now,
  ) {}

  /** 自动采集入口（阅读达到阈值时调用） */
  async handleCandidate(candidate: CaptureCandidate): Promise<CaptureOutcome> {
    const settings = await this.settingsRepo.get();

    // 阅读阈值二次校验（防止手动构造消息绕过）
    if (candidate.source === 'auto') {
      if (candidate.readingDurationMs < settings.minReadingDurationMs) {
        return { status: 'skipped', reason: 'insufficient-reading' };
      }
      if (candidate.maxScrollRatio < settings.minScrollRatio) {
        return { status: 'skipped', reason: 'insufficient-reading' };
      }
    }

    if (candidate.text.length < settings.minTextLength && candidate.source === 'auto') {
      return { status: 'skipped', reason: 'insufficient-content' };
    }

    const privacyInput: PrivacyInput = {
      url: candidate.url,
      isIncognito: candidate.isIncognito,
      title: candidate.title,
    };
    const decision =
      candidate.source === 'manual'
        ? await this.privacy.evaluateManual(privacyInput)
        : await this.privacy.evaluate(privacyInput);

    if (!decision.allowed) {
      return { status: 'skipped', reason: decision.reason ?? 'excluded-domain', matchedRule: decision.matchedRule };
    }

    try {
      const record = await this.persist(candidate);
      // 数据库成功后更新索引；索引失败保留数据库记录并标记重建（第 12 节 5）
      try {
        await this.search.update(record);
      } catch {
        this.search.markNeedsRebuild();
      }
      return { status: 'captured', pageId: record.id, record };
    } catch (err) {
      return { status: 'failed', message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** 幂等写入：以 canonicalUrl 去重；每次访问追加 VisitRecord */
  private async persist(candidate: CaptureCandidate): Promise<PageRecord> {
    const now = this.now();
    const canonicalUrl = canonicalizeUrl(candidate.url);
    const domain = extractDomain(candidate.url);
    const text = candidate.text.length > MAX_TEXT_LENGTH
      ? candidate.text.slice(0, MAX_TEXT_LENGTH)
      : candidate.text;

    const existing = await this.pages.findByCanonicalUrl(canonicalUrl);
    const isContentChanged =
      existing !== undefined &&
      (existing.text !== text || existing.title !== candidate.title);

    const record: PageRecord = {
      id: existing?.id ?? generatePageId(now),
      canonicalUrl,
      url: candidate.url,
      title: candidate.title,
      domain,
      text,
      excerpt: candidate.excerpt,
      author: undefined,
      publishedAt: undefined,
      firstVisitedAt: existing?.firstVisitedAt ?? now,
      lastVisitedAt: now,
      visitCount: (existing?.visitCount ?? 0) + 1,
      readingDurationMs: Math.max(existing?.readingDurationMs ?? 0, candidate.readingDurationMs),
      maxScrollRatio: Math.max(existing?.maxScrollRatio ?? 0, candidate.maxScrollRatio),
      source: candidate.source,
      status: 'captured',
      createdAt: existing?.createdAt ?? now,
      updatedAt: isContentChanged ? now : (existing?.updatedAt ?? now),
    };

    await this.pages.upsert(record);

    const visit: VisitRecord = {
      id: makeVisitId(),
      pageId: record.id,
      tabId: candidate.tabId,
      url: candidate.url,
      startedAt: now - candidate.readingDurationMs,
      endedAt: now,
      durationMs: candidate.readingDurationMs,
      maxScrollRatio: candidate.maxScrollRatio,
      foregroundMs: candidate.readingDurationMs,
    };
    await this.visits.create(visit);

    return record;
  }
}

function generatePageId(now: number): string {
  return `p_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export type { CaptureSource };
