// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';

// 验证 ErrorBoundary 重试计数 bug
describe('边界测试：ErrorBoundary 重试限制', () => {
  it('retryCount 在每次错误后被重置为 0，导致重试限制不生效', () => {
    let throwError = true;

    function FlakyComponent() {
      if (throwError) throw new Error('测试错误');
      return <div>成功</div>;
    }

    const { container, rerender } = render(
      <ErrorBoundary>
        <FlakyComponent />
      </ErrorBoundary>
    );

    // 第一次错误：显示重试按钮
    expect(container.textContent).toContain('出了点问题');
    expect(container.textContent).toContain('重试');

    // 点击重试，先不抛错让重试成功
    throwError = false;
    fireEvent.click(container.querySelector('button')!);
    expect(container.textContent).toContain('成功');

    // 再次触发错误
    throwError = true;
    rerender(
      <ErrorBoundary>
        <FlakyComponent />
      </ErrorBoundary>
    );

    // retryCount 被 getDerivedStateFromError 重置为 0，所以仍然显示"重试"而非"刷新页面"
    expect(container.textContent).toContain('重试');
    expect(container.textContent).not.toContain('刷新页面');
  });
});
