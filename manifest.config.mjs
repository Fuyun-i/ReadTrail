// MV3 manifest 生成模块 —— build 脚本据此写入 dist/manifest.json
// ReadTrail：右上角扩展入口（搜索小窗口 + 独立记录库），不再替换新标签页
export const APP_NAME = 'ReadTrail';
export const APP_VERSION = '0.2.0';

export function buildManifest() {
  return {
    manifest_version: 3,
    name: APP_NAME,
    version: APP_VERSION,
    description: "Find what you've read. 找回你读过的网页 — 本地自动记录与检索。",
    minimum_chrome_version: '116',

    permissions: ['storage', 'tabs', 'contextMenus', 'scripting'],
    host_permissions: ['http://*/*', 'https://*/*'],

    background: {
      service_worker: 'background/service-worker.js',
      type: 'module',
    },

    content_scripts: [
      {
        matches: ['http://*/*', 'https://*/*'],
        js: ['content/content-main.js'],
        run_at: 'document_idle',
        all_frames: false,
      },
    ],

    // 工具栏入口：点击图标打开搜索小窗口（E-002/E-004）
    action: {
      default_popup: 'popup/popup.html',
      default_title: "ReadTrail — Find what you've read.",
    },

    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
  };
}
