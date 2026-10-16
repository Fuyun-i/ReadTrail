// QueryParser 高级语法测试：OR / NOT / 精确短语 / tag:
import { describe, it, expect } from 'vitest';
import { QueryParser } from '../src/search/query-parser';

describe('QueryParser 高级语法', () => {
  const parser = new QueryParser();
  const NOW = 1700000000000;

  it('tag: 语法提取标签', async () => {
    const result = await parser.parse('tag:rust async runtime', NOW);
    expect(result.tags).toEqual(['rust']);
    expect(result.text).toBe('async runtime');
  });

  it('多个 tag: 语法', async () => {
    const result = await parser.parse('tag:rust tag:go concurrency', NOW);
    expect(result.tags).toEqual(['rust', 'go']);
    expect(result.text).toBe('concurrency');
  });

  it('NOT 排除：-tokio', async () => {
    const result = await parser.parse('rust -tokio', NOW);
    expect(result.excludeTerms).toEqual(['tokio']);
    expect(result.text).toBe('rust');
  });

  it('多个 NOT 排除', async () => {
    const result = await parser.parse('rust -tokio -async', NOW);
    expect(result.excludeTerms).toEqual(['tokio', 'async']);
    expect(result.text).toBe('rust');
  });

  it('精确短语："async runtime"', async () => {
    const result = await parser.parse('"async runtime" tokio', NOW);
    expect(result.phrases).toEqual(['async runtime']);
    expect(result.text).toBe('tokio');
  });

  it('多个精确短语', async () => {
    const result = await parser.parse('"async runtime" "memory safe" rust', NOW);
    expect(result.phrases).toEqual(['async runtime', 'memory safe']);
    expect(result.text).toBe('rust');
  });

  it('OR 操作符：rust OR go', async () => {
    const result = await parser.parse('rust OR go', NOW);
    expect(result.orGroups).toEqual([['rust', 'go']]);
  });

  it('组合语法：tag:rust "async runtime" -tokio', async () => {
    const result = await parser.parse('tag:rust "async runtime" -tokio', NOW);
    expect(result.tags).toEqual(['rust']);
    expect(result.phrases).toEqual(['async runtime']);
    expect(result.excludeTerms).toEqual(['tokio']);
  });

  it('domain: + tag: 组合', async () => {
    const result = await parser.parse('domain:github.com tag:rust async', NOW);
    expect(result.domains).toEqual(['github.com']);
    expect(result.tags).toEqual(['rust']);
    expect(result.text).toBe('async');
  });

  it('无高级语法时字段为 undefined', async () => {
    const result = await parser.parse('simple query', NOW);
    expect(result.tags).toBeUndefined();
    expect(result.phrases).toBeUndefined();
    expect(result.excludeTerms).toBeUndefined();
    expect(result.orGroups).toBeUndefined();
  });

  it('时间短语仍然正常工作', async () => {
    const result = await parser.parse('昨天看过 rust', NOW);
    // 昨天：午夜对齐，from = 昨天零点
    const dayStart = new Date(NOW);
    dayStart.setHours(0, 0, 0, 0);
    const startOfToday = dayStart.getTime();
    expect(result.from).toBe(startOfToday - 86400000);
    expect(result.to).toBe(startOfToday);
    expect(result.text).toContain('rust');
  });
});
