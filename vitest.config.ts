import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['tests/setup.ts'],
    // jsdom 环境用于需要 DOM API 的测试（article-extractor / reader-observer / highlight）
    // 默认 node 环境用于纯逻辑测试
    environment: 'node',
    // 按需覆盖：在测试文件顶部用 // @vitest-environment jsdom 注释切换
    environmentMatchGlobs: [
      ['tests/article-extractor.test.ts', 'jsdom'],
      ['tests/reader-observer.test.ts', 'jsdom'],
      ['tests/highlight.test.tsx', 'jsdom'],
    ],
  },
});
