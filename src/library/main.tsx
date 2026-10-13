import { createRoot } from 'react-dom/client';
import App from './App';
import { installDemoShimIfNeeded } from './demo-shim';

// 非扩展环境（http:// 预览）下降级为演示数据；扩展环境中检测到 chrome.runtime 即跳过
installDemoShimIfNeeded();

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');
createRoot(container).render(<App />);
