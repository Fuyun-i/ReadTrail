// ===== 公共类型定义（对应 architecture.md 第 4 节）=====

export type CaptureSource = 'auto' | 'manual';

export type CaptureStatus = 'candidate' | 'captured' | 'skipped' | 'failed';

export type SkipReason =
  | 'private-window'
  | 'sensitive-domain'
  | 'browser-page'
  | 'disabled'
  | 'insufficient-reading'
  | 'insufficient-content'
  | 'excluded-domain';

export type PageRecord = {
  id: string;
  canonicalUrl: string;
  url: string;
  title: string;
  domain: string;
  text: string;
  excerpt: string;
  author?: string;
  publishedAt?: number;
  firstVisitedAt: number;
  lastVisitedAt: number;
  visitCount: number;
  readingDurationMs: number;
  maxScrollRatio: number;
  source: CaptureSource;
  status: CaptureStatus;
  createdAt: number;
  tags?: string[];
  updatedAt: number;
};

export type VisitRecord = {
  id: string;
  pageId?: string;
  tabId: number;
  url: string;
  startedAt: number;
  endedAt?: number;
  durationMs: number;
  maxScrollRatio: number;
  foregroundMs: number;
};

export type CaptureCandidate = {
  url: string;
  title: string;
  text: string;
  excerpt: string;
  readingDurationMs: number;
  maxScrollRatio: number;
  tabId: number;
  windowId: number;
  isIncognito: boolean;
  source: CaptureSource;
};

export type SearchInput = {
  query: string;
  from?: number;
  to?: number;
  domain?: string;
  source?: CaptureSource;
  limit?: number;
  offset?: number;
  sort?: 'relevance' | 'recent' | 'frequent';
  tags?: string[];
  phrases?: string[];
  excludeTerms?: string[];
  orGroups?: string[][];
};

export type SearchMatchField = 'title' | 'domain' | 'text' | 'excerpt';

export type SearchHighlight = {
  field: string;
  text: string;
  start: number;
  end: number;
};

export type SearchResult = {
  page: PageRecord;
  score: number;
  matchedFields: SearchMatchField[];
  highlights: SearchHighlight[];
};

// ===== Content Script 侧类型（architecture.md 5.1 / 5.2）=====

export type ReadingSnapshot = {
  url: string;
  title: string;
  startedAt: number;
  activeDurationMs: number;
  maxScrollRatio: number;
  visibility: 'visible' | 'hidden';
  routeVersion: number;
};

export type ExtractedArticle = {
  url: string;
  title: string;
  text: string;
  excerpt: string;
  author?: string;
  publishedAt?: number;
  wordCount: number;
  extractionMethod: 'readability' | 'semantic' | 'fallback';
};

// ===== 设置（architecture.md 第 10 节）=====

export type UserSettings = {
  enabled: boolean;
  minReadingDurationMs: number;
  minScrollRatio: number;
  minTextLength: number;
  excludedDomains: string[];
  includedDomains: string[];
  retentionDays?: number;
  searchResultLimit: number;
};

export type ValidationResult = {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
};

// ===== 导入导出（architecture.md 第 11 节）=====

export type ExportOptions = {
  from?: number;
  to?: number;
  pageIds?: string[];
  includeVisits?: boolean;
};

export type ImportOptions = {
  mode?: 'merge' | 'replace';
};

export type ImportReport = {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ index: number; message: string }>;
};

// ===== 搜索健康状态（architecture.md 第 9 节）=====

export type SearchHealth = {
  ready: boolean;
  indexedCount: number;
  databaseCount: number;
  needsRebuild: boolean;
  lastRebuiltAt?: number;
};
