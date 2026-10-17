// ===== 查询解析器（architecture.md 第 9 节）=====
// 支持：时间短语、domain: 过滤、tag: 过滤、OR 操作符、NOT 排除（-word）、精确短语（"..."）

import type { ParsedQuery } from './types';

const TIME_PHRASES: Array<{ pattern: RegExp; days: number; bounded?: boolean; today?: boolean }> = [
  { pattern: /上周|上星期|last week/i, days: 7 },
  { pattern: /昨天|yesterday/i, days: 1, bounded: true },
  { pattern: /今天|today/i, days: 0, bounded: true, today: true },
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
    // M6: 查询长度限制，防止超长查询导致性能问题
    // 注意：截断可能破坏未闭合的语法（如 "phrase 或 domain:partial），
    // 但作为 DoS 防御可接受——超 2000 字符的查询本身就不是正常使用场景
    let text = input.length > 2000 ? input.slice(0, 2000) : input;
    let from: number | undefined;
    let to: number | undefined;
    const domains: string[] = [];
    const tags: string[] = [];
    const phrases: string[] = [];
    const excludeTerms: string[] = [];

    // domain:example.com 过滤语法（可多次）
    // L6: 域名只取到 | 或下一个过滤语法前，避免 domain:a|tag:b 把 |tag:b 也当域名
    // L19: 域名只取到 / | 或空格前，不捕获路径
    text = text.replace(/(?:domain|站点|网站)[:：]([^\s|/]+)/gi, (_m, domain: string) => {
      if (domain) domains.push(domain.toLowerCase());
      return '';
    });

    // tag:rust 过滤语法（可多次）
    text = text.replace(/tag[:：]([^\s|]+)/gi, (_m, tag: string) => {
      if (tag) tags.push(tag.toLowerCase());
      return '';
    });

    // 精确短语："async runtime" → 提取后从 text 中移除
    text = text.replace(/"([^"]+)"/g, (_m, phrase: string) => {
      phrases.push(phrase);
      return ' ';
    });

    // 时间短语
    for (const { pattern, days, bounded, today } of TIME_PHRASES) {
      if (pattern.test(text)) {
        if (bounded) {
          const dayStart = new Date(now);
          dayStart.setHours(0, 0, 0, 0);
          const startOfToday = dayStart.getTime();
          if (today) {
            // 今天：from = 今天零点, to = now
            from = startOfToday;
            to = now;
          } else {
            // 昨天：from = 昨天零点, to = 今天零点
            from = startOfToday - days * 86_400_000;
            to = startOfToday;
          }
        } else {
          from = now - days * 86_400_000;
        }
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

    // NOT 排除：-word（L20: --word 不视为 NOT，避免 --flag 被误排除）
    text = text.replace(/(?:^|\s)-([^\s-][^\s]*)/g, (_m, word: string) => {
      excludeTerms.push(word.toLowerCase());
      return ' ';
    });

    // OR 分组：检测 "word1 OR word2 OR word3" 模式
    // 当前版本退化为普通 token 匹配（AND 语义），但移除 OR 关键词避免其作为搜索 token 泄漏
    const orGroups: string[][] = [];
    const orDelimiter = /\s+(?:OR|或|\|)\s+/i;
    const tokens = text.split(orDelimiter);
    if (tokens.length >= 2) {
      orGroups.push(tokens.map((t) => t.trim().toLowerCase()).filter(Boolean));
      // 用空格重新连接 tokens（移除 OR/或/| 关键词），保留实际搜索词
      text = tokens.join(' ');
    }

    text = text.replace(/\s+/g, ' ').trim();

    return {
      text,
      from,
      to,
      domains: domains.length ? domains : undefined,
      tags: tags.length ? tags : undefined,
      phrases: phrases.length ? phrases : undefined,
      excludeTerms: excludeTerms.length ? excludeTerms : undefined,
      orGroups: orGroups.length ? orGroups : undefined,
      confidence: text ? 1 : 0,
    };
  }
}

/** 简易 CJK/英文混合分词：连续英文按词，CJK 按二元组 */
const CJK_RUN = /[一-鿿ぁ-ヿ가-힯]/;

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
