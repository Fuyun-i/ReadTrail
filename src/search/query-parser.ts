// ===== 查询解析器（architecture.md 第 9 节）=====
// 首版：解析时间短语、域名过滤语法 domain:xxx，其余作为关键词。
// 无本地模型时 confidence 固定 0，仅执行规则解析。

import type { ParsedQuery } from './types';

const TIME_PHRASES: Array<{ pattern: RegExp; days: number }> = [
  { pattern: /上周|上星期|last week/i, days: 7 },
  { pattern: /昨天|yesterday/i, days: 1 },
  { pattern: /今天|today/i, days: 1 },
  { pattern: /上月|上个月|last month/i, days: 30 },
  { pattern: /最近三天|最近3天|last 3 days/i, days: 3 },
  { pattern: /最近一周|最近7天|last 7 days/i, days: 7 },
  { pattern: /最近一月|最近一个月|last 30 days/i, days: 30 },
  { pattern: /三个月前|近三个月|last 3 months/i, days: 90 },
  { pattern: /半年|last 6 months/i, days: 180 },
  { pattern: /今年|this year/i, days: 365 },
];

/** 形如 "3天前" "2 weeks ago" 的通用模式 */
const RELATIVE_PATTERNS: Array<{ pattern: RegExp; unitMs: number }> = [
  { pattern: /(\d+)\s*天前/, unitMs: 86_400_000 },
  { pattern: /(\d+)\s*周前/, unitMs: 7 * 86_400_000 },
  { pattern: /(\d+)\s*个月前/, unitMs: 30 * 86_400_000 },
  { pattern: /(\d+)\s*小时前/, unitMs: 3_600_000 },
  { pattern: /(\d+)\s*days?\s+ago/i, unitMs: 86_400_000 },
  { pattern: /(\d+)\s*weeks?\s+ago/i, unitMs: 7 * 86_400_000 },
  { pattern: /(\d+)\s*months?\s+ago/i, unitMs: 30 * 86_400_000 },
];

export class QueryParser {
  async parse(input: string, now: number = Date.now()): Promise<ParsedQuery> {
    let text = input;
    let from: number | undefined;
    let to: number | undefined;
    const domains: string[] = [];

    // domain:example.com 过滤语法（可多次）
    text = text.replace(/(?:domain|站点|网站)[:：](\S+)/gi, (_m, domain: string) => {
      domains.push(domain.toLowerCase());
      return '';
    });

    // 时间短语
    for (const { pattern, days } of TIME_PHRASES) {
      if (pattern.test(text)) {
        // "上周/昨天" 等区间语义：从 N 天前到 N-1 天前；这里统一放宽为「从 N 天前到现在」
        from = now - days * 86_400_000;
        text = text.replace(pattern, ' ');
        break;
      }
    }

    // "N 天前" 通用相对时间
    if (from === undefined) {
      for (const { pattern, unitMs } of RELATIVE_PATTERNS) {
        const match = text.match(pattern);
        if (match?.[1]) {
          from = now - Number(match[1]) * unitMs;
          text = text.replace(pattern, ' ');
          break;
        }
      }
    }

    text = text.replace(/\s+/g, ' ').trim();

    return {
      text,
      from,
      to,
      domains: domains.length ? domains : undefined,
      confidence: 0, // 无本地模型，仅规则解析
    };
  }
}

/** 简易 CJK/英文混合分词：连续英文按词，CJK 按二元组 */
// CJK 字符范围正则（模块级常量，避免每次调用重新创建）
const CJK_RUN = /[一-鿿぀-ヿ가-힯]/;

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const cjkRun = CJK_RUN;
  let buffer = '';
  let cjkBuffer = '';

  const flushLatin = () => {
    if (buffer) {
      tokens.push(buffer.toLowerCase());
      buffer = '';
    }
  };
  const pushCjkChar = (ch: string) => {
    cjkBuffer += ch;
    if (cjkBuffer.length > 2) cjkBuffer = cjkBuffer.slice(-2);
    if (cjkBuffer.length === 2) tokens.push(cjkBuffer);
  };

  for (const ch of text) {
    if (cjkRun.test(ch)) {
      flushLatin();
      // 单个 CJK 字符也输出，保证 1 字查询可命中
      tokens.push(ch);
      pushCjkChar(ch);
    } else if (/\w/.test(ch)) {
      cjkBuffer = '';
      buffer += ch;
    } else {
      flushLatin();
      cjkBuffer = '';
    }
  }
  flushLatin();
  return tokens;
}

/** 生成查询用 token（查询侧同样按 bigram 切，保证召回一致） */
export function tokenizeQuery(query: string): string[] {
  return tokenize(query);
}
