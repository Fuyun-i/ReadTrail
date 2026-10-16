// ===== React Error Boundary =====
// 捕获 library / popup 渲染异常，避免白屏。
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
  retryCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '', retryCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    // M13: 不重置 retryCount，否则重试后再报错会无限重试
    return { hasError: true, message: error.message || String(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ReadTrail] 渲染异常:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const maxRetries = 3;
      return this.props.fallback ?? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
          <h2>出了点问题</h2>
          <p>{this.state.message}</p>
          {this.state.retryCount < maxRetries ? (
            <button onClick={() => this.setState((s) => ({ hasError: false, message: '', retryCount: s.retryCount + 1 }))}>重试</button>
          ) : (
            <button onClick={() => location.reload()}>刷新页面</button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
