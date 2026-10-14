// esbuild 构建脚本：分别打包 service worker / content script / newtab 三个入口
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../manifest.config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

// 构建前清理 dist，防止旧文件残留进发布包（watch 模式不清，避免删除运行中产物）
// 目录被占用（如本地静态服务器仍在服务）时警告并继续，不清空但仍然写入
if (!watch && existsSync(dist)) {
  try {
    rmSync(dist, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[build] 无法清理 dist/（可能有进程占用）：${err instanceof Error ? err.message : err}`);
    console.warn('[build] 继续增量构建，建议关闭占用 dist 的进程后重新构建');
  }
}
mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  format: 'esm',
  target: ['chrome116'],
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  absWorkingDir: root,
};

/** @type {import('esbuild').BuildOptions[]} */
const entries = [
  {
    ...common,
    entryPoints: { 'background/service-worker': 'src/background/service-worker.ts' },
    outdir: dist,
  },
  {
    ...common,
    entryPoints: { 'content/content-main': 'src/content/content-main.ts' },
    outdir: dist,
  },
  {
    // 独立记录库（原新标签页界面，用户主动打开）
    ...common,
    entryPoints: { 'library/library': 'src/library/main.tsx' },
    outdir: dist,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  {
    // 搜索小窗口（工具栏 action.default_popup）
    ...common,
    entryPoints: { 'popup/popup': 'src/popup/main.tsx' },
    outdir: dist,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  },
];

function writeManifest() {
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(buildManifest(), null, 2) + '\n');
}

async function run() {
  const results = await Promise.all(entries.map((e) => build(e).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
    return null;
  })));

  if (results.some(Boolean)) {
    writeManifest();
    cpSync(join(root, 'public'), join(dist, '.'), { recursive: true });
  }
  console.log(watch ? 'watching for changes...' : 'build complete');
}

if (watch) {
  // 简易 watch：借助 esbuild context
  const { context } = await import('esbuild');
  await Promise.all(
    entries.map(async (e) => {
      const ctx = await context(e);
      await ctx.watch();
    }),
  );
  writeManifest();
  cpSync(join(root, 'public'), join(dist, '.'), { recursive: true });
  console.log('watching for changes...');
} else {
  await run();
}
