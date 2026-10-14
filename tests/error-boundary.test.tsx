// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';

describe('ErrorBoundary', () => {
  it('(1) 正常渲染 children', () => {
    const { container } = render(
      <ErrorBoundary>
        <div data-testid="child">正常内容</div>
      </ErrorBoundary>
    );
    expect(container.textContent).toContain('正常内容');
  });

  it('(2) 捕获渲染异常显示默认 fallback', () => {
    const BadComponent = (): JSX.Element => {
      throw new Error('测试爆炸');
    };

    // 抑制 console.error 输出
    const originalError = console.error;
    console.error = () => {};
    try {
      const { container } = render(
        <ErrorBoundary>
          <BadComponent />
        </ErrorBoundary>
      );
      expect(container.textContent).toContain('出了点问题');
      expect(container.textContent).toContain('测试爆炸');
    } finally {
      console.error = originalError;
    }
  });

  it('(3) 捕获渲染异常显示自定义 fallback', () => {
    const BadComponent = (): JSX.Element => {
      throw new Error('自定义错误');
    };

    const originalError = console.error;
    console.error = () => {};
    try {
      const { container } = render(
        <ErrorBoundary fallback={<div data-testid="custom">自定义降级</div>}>
          <BadComponent />
        </ErrorBoundary>
      );
      expect(container.textContent).toContain('自定义降级');
    } finally {
      console.error = originalError;
    }
  });
});
