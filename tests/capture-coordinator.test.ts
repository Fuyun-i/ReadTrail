// CaptureCoordinator 单元测试
// mock 五个依赖接口，覆盖采集协调器的所有分支逻辑

import { describe, it, expect, vi } from 'vitest';
import { CaptureCoordinator } from '../src/background/capture-coordinator';
import type { CaptureOutcome } from '../src/background/capture-coordinator';
import type { CaptureCandidate, PageRecord, UserSettings, VisitRecord } from '../src/shared/types';
import type { PrivacyPolicy, PrivacyInput, PrivacyDecision } from '../src/background/privacy-policy';
import type { PageRepository } from '../src/storage/repositories/page-repository';
import type { VisitRepository } from '../src/storage/repositories/visit-repository';
import type { SettingsRepository } from '../src/storage/repositories/settings-repository';
import type { SearchProvider } from '../src/search/search-provider';

// ---- 工厂函数 ----

const FIXED_NOW = 1700000000000;
// 默认正文长度需超过 minTextLength=300
const DEFAULT_TEXT = 'This is a test article with enough content to pass the minimum text length check. '.repeat(10);

function makeCandidate(overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    url: 'https://example.com/article',
    title: 'Test Article',
    text: DEFAULT_TEXT,
    excerpt: 'Test article excerpt',
    readingDurationMs: 15_000,
    maxScrollRatio: 0.5,
    tabId: 1,
    windowId: 1,
    isIncognito: false,
    source: 'auto',
    ...overrides,
  };
}

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    enabled: true,
    minReadingDurationMs: 10_000,
    minScrollRatio: 0.25,
    minTextLength: 300,
    excludedDomains: [],
    includedDomains: [],
    retentionDays: undefined,
    searchResultLimit: 30,
    ...overrides,
  };
}

function makePageRecord(overrides: Partial<PageRecord> = {}): PageRecord {
  const now = FIXED_NOW;
  return {
    id: 'p_test',
    canonicalUrl: 'https://example.com/article',
    url: 'https://example.com/article',
    title: 'Test Article',
    domain: 'example.com',
    text: DEFAULT_TEXT,
    excerpt: 'excerpt',
    firstVisitedAt: now,
    lastVisitedAt: now,
    visitCount: 1,
    readingDurationMs: 15_000,
    maxScrollRatio: 0.5,
    source: 'auto',
    status: 'captured',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---- mock 创建器 ----

function makeMocks() {
  const mockPrivacy = {
    evaluate: vi.fn<(input: PrivacyInput) => Promise<PrivacyDecision>>().mockResolvedValue({ allowed: true }),
    evaluateManual: vi.fn<(input: PrivacyInput) => Promise<PrivacyDecision>>().mockResolvedValue({ allowed: true, matchedRule: 'manual-override' }),
  } as unknown as PrivacyPolicy;

  const mockPages = {
    findByCanonicalUrl: vi.fn<(url: string) => Promise<PageRecord | undefined>>().mockResolvedValue(undefined),
    upsert: vi.fn<(record: PageRecord) => Promise<PageRecord>>().mockImplementation(async (r) => r),
  } as unknown as PageRepository;

  const mockVisits = {
    create: vi.fn<(record: VisitRecord) => Promise<void>>().mockResolvedValue(undefined),
  } as unknown as VisitRepository;

  const mockSettings = {
    get: vi.fn<() => Promise<UserSettings>>().mockResolvedValue(makeSettings()),
  } as unknown as SettingsRepository;

  const mockSearch = {
    update: vi.fn<(record: PageRecord) => Promise<void>>().mockResolvedValue(undefined),
    markNeedsRebuild: vi.fn(),
  } as unknown as SearchProvider;

  return { mockPrivacy, mockPages, mockVisits, mockSettings, mockSearch };
}

function makeCoordinator(mocks: ReturnType<typeof makeMocks>) {
  return new CaptureCoordinator(
    mocks.mockPrivacy,
    mocks.mockPages,
    mocks.mockVisits,
    mocks.mockSettings,
    mocks.mockSearch,
    () => FIXED_NOW,
  );
}

// ---- 测试 ----

describe('CaptureCoordinator', () => {
  it('(1) auto 阈值不达标 → skipped:insufficient-reading', async () => {
    const mocks = makeMocks();
    mocks.mockSettings.get.mockResolvedValue(makeSettings({ minReadingDurationMs: 20_000 }));
    const coord = makeCoordinator(mocks);

    const result = await coord.handleCandidate(makeCandidate({ readingDurationMs: 10_000 }));
    expect(result.status).toBe('skipped');
    expect((result as Extract<CaptureOutcome, { status: 'skipped' }>).reason).toBe('insufficient-reading');
  });

  it('(2) 正文过短 → skipped:insufficient-content', async () => {
    const mocks = makeMocks();
    mocks.mockSettings.get.mockResolvedValue(makeSettings({ minTextLength: 500 }));
    const coord = makeCoordinator(mocks);

    const result = await coord.handleCandidate(makeCandidate({ text: 'too short' }));
    expect(result.status).toBe('skipped');
    expect((result as Extract<CaptureOutcome, { status: 'skipped' }>).reason).toBe('insufficient-content');
  });

  it('(3) 隐私策略拒绝 → skipped:excluded-domain', async () => {
    const mocks = makeMocks();
    mocks.mockPrivacy.evaluate.mockResolvedValue({
      allowed: false,
      reason: 'excluded-domain',
      matchedRule: 'exclude:example.com',
    });
    const coord = makeCoordinator(mocks);

    const result = await coord.handleCandidate(makeCandidate());
    expect(result.status).toBe('skipped');
    const skipped = result as Extract<CaptureOutcome, { status: 'skipped' }>;
    expect(skipped.reason).toBe('excluded-domain');
    expect(skipped.matchedRule).toBe('exclude:example.com');
  });

  it('(4) 新页面首次保存 → captured，字段正确', async () => {
    const mocks = makeMocks();
    const coord = makeCoordinator(mocks);

    const result = await coord.handleCandidate(makeCandidate());
    expect(result.status).toBe('captured');
    const captured = result as Extract<CaptureOutcome, { status: 'captured' }>;
    expect(captured.pageId).toBeTruthy();
    expect(captured.record.title).toBe('Test Article');
    expect(captured.record.domain).toBe('example.com');
    expect(captured.record.visitCount).toBe(1);
    expect(captured.record.firstVisitedAt).toBe(FIXED_NOW);
    expect(captured.record.lastVisitedAt).toBe(FIXED_NOW);
    expect(captured.record.source).toBe('auto');

    // 验证 upsert 和 visits.create 被调用
    expect(mocks.mockPages.upsert).toHaveBeenCalledOnce();
    expect(mocks.mockVisits.create).toHaveBeenCalledOnce();
    expect(mocks.mockSearch.update).toHaveBeenCalledOnce();
  });

  it('(5) 同 canonicalUrl 二次访问 → visitCount 递增、firstVisitedAt 保留', async () => {
    const mocks = makeMocks();
    const existing = makePageRecord({
      id: 'p_existing',
      visitCount: 3,
      firstVisitedAt: FIXED_NOW - 100_000,
      createdAt: FIXED_NOW - 100_000,
    });
    mocks.mockPages.findByCanonicalUrl.mockResolvedValue(existing);
    const coord = makeCoordinator(mocks);

    const result = await coord.handleCandidate(makeCandidate());
    expect(result.status).toBe('captured');
    const captured = result as Extract<CaptureOutcome, { status: 'captured' }>;
    expect(captured.record.id).toBe('p_existing');
    expect(captured.record.visitCount).toBe(4);
    expect(captured.record.firstVisitedAt).toBe(FIXED_NOW - 100_000);
    expect(captured.record.createdAt).toBe(FIXED_NOW - 100_000);
    expect(captured.record.lastVisitedAt).toBe(FIXED_NOW);
  });

  it('(6) 正文内容变化 → updatedAt 更新', async () => {
    const mocks = makeMocks();
    const existing = makePageRecord({
      id: 'p_existing',
      text: 'old content',
      updatedAt: FIXED_NOW - 50_000,
    });
    mocks.mockPages.findByCanonicalUrl.mockResolvedValue(existing);
    const coord = makeCoordinator(mocks);

    const newText = 'completely new content that is different from old content. ' + 'x'.repeat(300);;
    const result = await coord.handleCandidate(makeCandidate({ text: newText }));
    expect(result.status).toBe('captured');
    const captured = result as Extract<CaptureOutcome, { status: 'captured' }>;
    expect(captured.record.updatedAt).toBe(FIXED_NOW);
  });

  it('(7) 正文超 500K → 截断', async () => {
    const mocks = makeMocks();
    const coord = makeCoordinator(mocks);

    const hugeText = 'x'.repeat(600_000);
    const result = await coord.handleCandidate(makeCandidate({ text: hugeText }));
    expect(result.status).toBe('captured');
    const captured = result as Extract<CaptureOutcome, { status: 'captured' }>;
    expect(captured.record.text.length).toBe(500_000);
  });

  it('(8) manual 保存跳过阈值但执行隐私', async () => {
    const mocks = makeMocks();
    const coord = makeCoordinator(mocks);

    // 阅读时长和滚动都不达标，但 manual 应跳过阈值
    const result = await coord.handleCandidate(
      makeCandidate({ source: 'manual', readingDurationMs: 1_000, maxScrollRatio: 0.01, text: 'short' }),
    );
    expect(result.status).toBe('captured');
    // manual 应调用 evaluateManual 而非 evaluate
    expect(mocks.mockPrivacy.evaluateManual).toHaveBeenCalledOnce();
    expect(mocks.mockPrivacy.evaluate).not.toHaveBeenCalled();
  });

  it('(9) 索引更新失败 → markNeedsRebuild 但 DB 记录保留', async () => {
    const mocks = makeMocks();
    mocks.mockSearch.update.mockRejectedValue(new Error('index error'));
    const coord = makeCoordinator(mocks);

    const result = await coord.handleCandidate(makeCandidate());
    // DB 记录已保存，只是索引失败
    expect(result.status).toBe('captured');
    expect(mocks.mockPages.upsert).toHaveBeenCalledOnce();
    expect(mocks.mockSearch.markNeedsRebuild).toHaveBeenCalledOnce();
  });

  it('(10) persist 失败 → failed 状态', async () => {
    const mocks = makeMocks();
    mocks.mockPages.upsert.mockRejectedValue(new Error('DB write failed'));
    const coord = makeCoordinator(mocks);

    const result = await coord.handleCandidate(makeCandidate());
    expect(result.status).toBe('failed');
    expect((result as Extract<CaptureOutcome, { status: 'failed' }>).message).toContain('DB write failed');
  });
});
