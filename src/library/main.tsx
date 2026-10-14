import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from '../ui/ErrorBoundary';

// 非扩展环境（http:// 预览）下降级为演示数据；扩展环境中检测到 chrome.runtime 即跳过。
// 使用动态 import() 确保演示数据模块不打入生产扩展包。
const w = globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } };
if (!w.chrome?.runtime?.sendMessage) {
  void import('./demo-shim').then(({ installDemoShimIfNeeded }) => {
    installDemoShimIfNeeded();
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');
createRoot(container).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
