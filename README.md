<div align="center">

# 🔍ReadTrail · 读过即存，一搜即回

**Save as you read. Find as you seek.**

一个保护隐私的本地网页记录与检索扩展，适用于 Chrome 和 Edge（Chromium Manifest V3）。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![Chrome](https://img.shields.io/badge/Chrome-116+-4285F4?logo=googlechrome&logoColor=white)](https://www.google.com/chrome/)
[![Edge](https://img.shields.io/badge/Edge-116+-0078D7?logo=microsoftedge&logoColor=white)](https://www.microsoft.com/edge)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853)](https://developer.chrome.com/docs/extensions/develop/mv3/intro)

</div>

---

## 这是什么

你是否遇到过这些问题？

- 「上周看过一篇讲 Rust 异步的文章，标题忘了，在哪个网站来着？」
- 「某个网页被关闭/改版/404 了，还想再看一遍内容」
- 浏览器历史记录只有网址列表，搜「内容里出现过的词」完全搜不到

**ReadTrail** 在你正常浏览时默默记录「你真正读过的网页正文」——不是收藏夹式的手动收藏，也不是历史记录式的只存 URL。当你在某个页面停留足够久并滚动阅读后，它会自动提取正文、保存到本机。之后任何时候，你只需要一个关键词就能找回它。

```
日常浏览网页 → 达到阅读阈值自动记录 → 某天需要找回 → 点击图标搜索关键词 → 找到
```

## ✨ 功能特性

### 📖 后台自动记录
- **智能正文提取**：Readability 算法 → 语义区域（`article`/`main`/`[role="main"]`）→ 可见文本，三级降级策略，适配绝大多数网页
- **真实的阅读判定**：只统计页面**可见时**的前台时间（切到别的标签页不计时），配合滚动比例，避免「开着页面干别的事」被误记
- **SPA 友好**：监听 `pushState`/`popstate` + `MutationObserver` 监听 title 变化，单页应用切换路由后重新独立计时
- **阈值可调**：默认 10 秒有效阅读 + 25% 滚动 + 300 字符正文，全部可在设置中修改

### 🔍 快速找回
- **搜索小窗口**：点击工具栏图标即弹出，焦点直接在搜索框，展示最近保存 / 搜索结果（最多 8 条）
- **中文全文检索**：基于 FlexSearch + 自研 CJK 分词（单字 + 二元组），中英文、混合关键词都能命中
- **智能查询语法**：
  - `domain:github.com rust` —— 限定域名搜索
  - `昨天 异步` / `上周 tokio` / `3天前的笔记` —— 中文英文自然时间短语自动转时间范围
- **一键续查**：在小窗口搜索后点「打开记录库」，查询自动带到完整界面

### 📚 独立记录库
- 完整搜索（相关度 / 最近访问 / 访问次数排序，域名筛选 debounce 自动搜索，关键词高亮）
- 历史列表（分页加载更多）、正文预览（展开全文）、单条删除
- JSON 备份导出/导入（merge 合并 / replace 替换）、Markdown 导出
- 索引健康检查与一键重建
- 设置页完整控件：阅读时长、滚动比例、正文最短长度、保留天数、搜索结果上限、排除/允许域名

### 🏷️ 标签与收藏
- 为页面添加自定义标签，搜索结果和历史记录中展示标签徽章
- 标签管理面板汇总所有标签及使用计数，点击标签快速筛选
- `tag:rust` 查询语法按标签过滤搜索结果
- 预览弹窗中直接添加/移除标签

### 💡 搜索增强
- **搜索建议**：输入时自动从标题、域名、搜索历史、热门标签中提取匹配建议，键盘 ↑↓ 选择
- **搜索历史**：自动记录最近 20 个搜索词（去重），搜索框 focus 时展示历史下拉
- **高级查询语法**：OR 操作符（`rust OR go`）、NOT 排除（`rust -tokio`）、精确短语（`"async runtime"`）
- **相关推荐**：预览弹窗展示基于标题和摘要的相似文章推荐（top 5）

### 🛡️ 隐私优先
| 保护 | 说明 |
| --- | --- |
| 无痕窗口 | 永不记录（任何设置都无法覆盖） |
| 敏感页面 | 银行、支付、邮箱、登录、管理后台等 URL 特征自动跳过 |
| 浏览器内部页 | `chrome://`、`edge://`、扩展商店等不注入不记录 |
| 排除域名 | 自定义黑名单；允许列表可覆盖黑名单但不能覆盖上面的保护 |
| 数据不出本机 | 全部数据存于浏览器 IndexedDB，**不向任何远程服务发送你的正文**，无任何统计上报 |
| 总开关 | 一键暂停自动记录；暂停期间所有页面停止采集，且允许列表不能绕过暂停 |

### ➕ 其他
- 右键菜单「立即保存此页」：无视阅读阈值手动保存（仍遵守隐私规则）
- 按 `lastVisitedAt` 自动清理过期数据（`retentionDays` 可选配置）
- Service Worker 重启后索引自动恢复，无需手动干预
- React Error Boundary 包裹 library 和 popup，渲染异常不白屏

## 📦 安装

### 方式一：从源码构建（推荐）

```bash
cd ReadTrail
npm install
npm run build
```

然后在浏览器中加载：

1. 打开 `edge://extensions`（Edge）或 `chrome://extensions`（Chrome）
2. 开启左下角 / 右上角的「**开发人员模式**」
3. 点击「**加载解压缩的扩展**」，选择本项目的 `dist/` 目录
4. 建议在工具栏上固定 ReadTrail 图标（点击拼图图标 → 图钉），方便日常使用

### 方式二：使用构建产物

如果 Release 中提供了 `dist.zip`，下载解压后按上面第 2–4 步加载即可。

## 🚀 使用指南

### 日常：什么都不用做

正常浏览网页。当你在某个页面**可见阅读 10 秒以上、滚动超过 25%**，正文会自动保存。工具栏图标弹出的小窗口顶部会显示「记录中」状态。

### 找回：三步

1. **点击工具栏 ReadTrail 图标**，弹出搜索小窗口
2. **输入关键词**（支持正文里出现过的任何词），回车搜索；不输入则显示最近保存
3. 点击结果打开原网页；或点「**打开记录库**」查看完整结果、阅读保存的正文

### 查询语法示例

```
rust 异步                 # 中英文关键词，正文/标题/摘要全范围命中
domain:github.com node   # 限定 github.com 域名
昨天 typescript           # 只搜昨天及之后保存的记录
上周 flexsearch           # 支持中文与英文（last week）时间短语
3天前 vite                # 相对时间
tag:rust async           # 按标签筛选 + 关键词搜索
rust OR go               # OR 操作符：召回含 rust 或 go 的结果
rust -tokio              # NOT 排除：召回含 rust 但排除含 tokio 的结果
"async runtime" tokio    # 精确短语：引号内作为整体匹配
```

### 设置

在记录库「设置」页可以调整：

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| 启用自动采集 | 开 | 总开关；暂停后允许列表也无法绕过 |
| 最少阅读时长 | 10 秒 | 页面可见时的累计前台时间 |
| 最少滚动比例 | 25% | 判定「真的在读」 |
| 正文最短长度 | 300 字符 | 过短的页面不保存 |
| 保留天数 | 不启用 | 按最近访问时间自动清理过期记录 |
| 搜索结果上限 | 30 | 每次搜索返回的最大结果数 |
| 排除域名 | 空 | 这些域名不记录 |
| 允许域名 | 空 | 覆盖排除域名（但不能覆盖敏感页面/无痕保护） |

### 数据管理

- **导出**：JSON 全量备份（含访问记录）、Markdown 阅读导出
- **导入**：merge 模式合并去重，replace 模式整体替换；旧版备份兼容
- **清空**：一键删除全部本地数据

## 🧱 技术架构

```text
浏览器页面
    │
    ▼
Content Script（阅读观察 / 正文提取 / 上报）
    │ chrome.runtime
    ▼
Service Worker（隐私策略 / 采集协调 / 消息路由 / 备份 / 索引恢复）
    │
    ├── IndexedDB（pages / visits / settings / meta）—— 数据唯一事实来源
    └── FlexSearch 内存索引 —— 可重建缓存

工具栏 popup（快速搜索）──┐
记录库页面（完整功能）────┴── 复用同一消息协议与数据层
```

- **正文提取**：`@mozilla/readability` + 语义区域 + 可见文本三级降级，剔除脚本/样式/导航/Cookie 横幅等噪音
- **中文检索**：FlexSearch 字段索引（标题/域名/摘要/正文）+ CJK 单字与二元组分词，查询结果始终从 IndexedDB 回读完整记录
- **消息协议**：所有扩展页请求携带 `requestId`，响应经运行时校验；未知消息、非法载荷返回结构化错误码
- **崩溃恢复**：IndexedDB 为唯一事实来源，内存索引只是缓存——Service Worker 休眠/重启后自动重建，搜索不中断
- **性能优化**：IndexedDB 索引查询（`lastVisitedAt`/`domain`）+ `IDBKeyRange` + 游标分页，避免全表 `getAll` + JS filter

### 目录结构

```text
ReadTrail/
├── manifest.config.mjs    # MV3 manifest 生成配置
├── scripts/build.mjs      # esbuild 构建脚本（4 个入口）
├── public/                # 静态资源（HTML / CSS / 图标）
├── .github/workflows/     # CI（typecheck + test + build）
└── src/
    ├── background/        # Service Worker：协调器、隐私策略、路由、备份、恢复、清理
    ├── content/           # 内容脚本：阅读观察、正文提取、上报
    ├── storage/           # IndexedDB 封装与仓库层
    ├── search/            # FlexSearch 提供者、查询解析（时间/域名/CJK 分词）
    ├── library/           # 记录库界面（React：搜索/历史/设置/预览）
    ├── popup/             # 工具栏搜索小窗口（React）
    ├── ui/                # 界面共用 API 客户端、工具、高亮组件、Error Boundary
    └── shared/            # 类型、消息协议、错误码、URL 规范化
```

## 🛠️ 本地开发

```bash
npm install        # 安装依赖
npm run build      # 构建到 dist/
npm run dev        # watch 模式（改动后自动重建）
npm run typecheck  # TypeScript 严格模式检查
npm test           # 运行单元测试（vitest）
npm run lint       # ESLint 检查
npm run format     # Prettier 格式化
```

### 单元测试

`tests/` 目录覆盖核心模块（23 个测试文件，201 个用例）：

- 阅读阈值判定（`reading-threshold`）
- 查询解析与 CJK 分词（`query-parser`）+ 高级语法 OR/NOT/精确短语/tag（`query-parser-advanced`）
- URL 规范化 / 敏感 URL / 浏览器内部页判断（`url`）
- 备份导入导出校验（`backup-service`）
- 隐私策略（自动与手动保存的例外规则）
- 消息路由（`message-router`）+ 消息校验（`message-validation`）
- 搜索提供者（`search-provider`）+ 搜索建议（`search-suggester`）
- 标签 CRUD（`tag-crud`）+ 搜索历史存储（`search-history-repository`）
- 数据层集成测试：PageRepository / VisitRepository / SettingsRepository（fake-indexeddb）
- 采集协调器（`capture-coordinator`）+ 保留清理（`retention-cleaner`）+ 索引恢复（`index-recovery`）
- 正文提取（`article-extractor`）+ 阅读观察（`reader-observer`）
- UI 工具函数 + 高亮 + Error Boundary

提交前请保证 `npm run typecheck` 与 `npm test` 全部通过。

## 📋 更新日志

### v0.4.7

**第三轮综合审计修复（3 轮，45 个问题）**
- Critical：`dbGetPaged` 游标 skip 逻辑导致备份数据丢失
- High：`MANUAL_CAPTURE_REQUEST` 缺少内联长度校验
- Medium（8）：visit 校验、settings get() 校验、retention 删除顺序、Unicode 高亮修复、emptyQueryResults 摘要/排序、摘要长度限制、replace 模式 visits 预校验、SettingsTab NaN 防御、返回结构统一
- Low（18）：导入合并、死代码清理、CJK 高亮排序、matchesAnyDomain 修复、CJK_RUN 范围、cloneNode 防御、innerText fallback、Markdown 转义、tags 去重、title 类型检查、死校验器移除、ref 参数移除
- Round 3：语义路径 5MB throw 包裹 try/catch 走 fallback、emptyQueryResults 摘要截断实际生效、ref 参数移除实际生效 + 测试更新、matchesAnyDomain 修复同步到 flex-search-provider、validatePageRecord tags 去重 + 长度限制实际生效

**文档与版本号同步**
- README 更新日志：移除未发布的 v0.5.0 幽灵版本（其内容实为 v0.4.3 的工作），补齐 v0.4.2–v0.4.7 共 6 个缺失版本的更新日志
- `manifest.config.mjs` APP_VERSION 由 0.4.6 同步至 0.4.7，重新构建 `dist/`
- 验证：273 测试通过，TypeScript 零错误，ESLint 零警告

### v0.4.6

**审计修复（68 个问题：1 critical，12 high，32 medium，21 low，2 design）**
- Critical：3+ 字中文搜索静默失败（CJK bigram 分词修复）
- High：upsert/settings/addTag/removeTag 的 TOCTOU 竞争改为单 readwrite 事务；replace 模式导入先全量校验再删除；retention 清理非原子删除；全量 visits 加载导致 SW OOM 改分页；IMPORT_JSON 无大小限制加 64MB 上限；cloneNode 大 DOM 内存爆炸加 5MB 守卫；标签/短语空路径、大小写、OR 泄漏
- Medium（32）：搜索正确性、备份安全、存储健壮性、content script 容错、query parser 优化、消息校验
- Low（21）：隐私路径匹配、NaN 守卫、死代码移除、Unicode 高亮安全、重复计算合并
- 验证：273 测试通过，TypeScript clean，ESLint clean

### v0.4.5

**审计修复（31 个问题：3 critical，6 high，14 medium，8 low）**
- Critical：`validateCaptureCandidate` 误拒合法消息；`CLEAR_BEFORE` 在 service-worker 中死循环；`isBrowserPage` URL 匹配过宽
- High：content-main 对 undefined capture 结果崩溃；replace 模式导入数据丢失（删除前预校验）；OR 查询丢结果（保留 OR 词进搜索文本）；SettingsTab/PopupApp 对 undefined 崩溃
- Medium：首次挂载重复搜索、blob URL 泄漏（5min timeout fallback）、PreviewModal useCallback 依赖 + Escape 处理、SearchHistoryRepository.clear() 事务 await、域名匹配移除反向父级匹配、IMPORT_JSON 跳过 payload 大小检查、FlexSearchProvider.update catch + markNeedsRebuild、空查询过取 3x
- Low：移除死代码 downloadBase64、readLaunchParams useMemo、ErrorBoundary 重试计数（3 次后 reload）、onManualCaptureTrigger 返回 cleanup、toErrorInfo 错误分类、manifest 加 content_security_policy、移除死 listForIndex、capture-coordinator 保留已有 source、migrations 用 newVersion 参数
- 验证：typecheck ✅ | lint ✅ | unit 200/200 ✅ | E2E 17/17 ✅

### v0.4.4

**修复 26 个问题（5 critical，8 medium，13 lint warnings）**
- Critical：retention 清理批量终止死循环；测试 mock 类型 20 个 TypeScript 错误；ESLint v8→v9 flat config 迁移；Service Worker 生命周期问题；SearchHistoryRepository 未用导入
- Medium：listAllTags 改用索引替代全表扫描；流式批量导出；service-worker 问题；收窄过宽的 host_permissions；query-parser OR 正则；backup-service 导入校验 & SW 问题
- Lint（13）：移除死代码（blobToBase64、fallback var、未用导入）；修复 React hooks exhaustive-deps；PreviewModal 用 relatedLoading
- 验证：typecheck 0 错误，lint 0 警告，201 单元测试通过，17 E2E 测试通过

### v0.4.3

**标签与收藏系统**
- PageRecord 新增 `tags` 字段，DB migration v2→v3 添加 tags 多值索引
- PageRepository 新增 `addTag`/`removeTag`/`listByTag`/`listAllTags` 方法
- 消息协议新增 `GET_TAGS`/`UPDATE_TAGS`，UI 支持标签显示与编辑
- 标签管理面板展示所有标签及计数，`tag:rust` 查询语法按标签筛选

**搜索增强**
- 高级查询语法：OR 操作符（`rust OR go`）、NOT 排除（`rust -tokio`）、精确短语（`"async runtime"`）
- 搜索建议/自动补全：从标题、域名、搜索历史、热门标签提取建议，键盘导航
- 搜索历史记录：最近 20 个搜索词去重存储，搜索框 focus 时展示历史下拉
- 相关推荐：预览弹窗展示基于标题和摘要的相似文章（top 5）

**测试覆盖**
- 新增 12 个测试文件、36 个测试用例，总计 23 文件 201 用例全部通过
- 覆盖：QueryParser 高级语法、SearchSuggester、标签 CRUD、搜索历史存储

**E2E 自动化**
- Playwright E2E 测试套件（17 个用例全部通过），通过 launchPersistentContext + --load-extension 加载扩展
- 覆盖：popup、library、搜索、标签切换、设置、高级查询、排序、SW 存活、导入导出、manifest

### v0.4.2

**大数据量性能优化（10k+ 记录）**
- 请求持久化存储防止浏览器回收
- 流式索引重建（500 条/批）避免 OOM
- 批量 retention 清理减少事务开销
- 导出改用 chrome.downloads API 替代 base64 消息通道
- DB v2：新增 visitCount 索引用于高频排序查询
- 域名筛选改用 domain 索引替代全表扫描
- 导入去重改用批量查询（listIdsByPageIds）替代 listAll

**新功能：按时间范围删除**
- 支持删除过去 1h / 24h / 7d / 4m / 全部的记录
- 保留单条删除
- 批量删除带确认对话框

### v0.4.1

**Bug 修复（High）**
- `content-main.ts`: `Number(x) || fallback` 对合法的 0 值误判为 falsy，改用 `Number.isFinite` 检查
- `page-repository.ts`: 管道分隔域名筛选（`a.com|b.com`）的 OR 匹配现在正确工作
- `SettingsTab.tsx`: `retentionDays=0` 现在正确提交 `undefined` 表示永久保留，而非被忽略
- 新增 `PageRepository.listForIndex()`，索引重建时截断正文（20K 字符），减少内存占用

**优化（Medium）**
- `visit-repository.ts`: `deleteByPageId` 改为单事务游标遍历批量删除，替代逐条独立事务
- `retention-cleaner.ts`: 批量删除过期页面和 visits，减少串行事务
- `flex-search-provider.ts`: 搜索分页不足时自动迭代追加查询；`globalThis` 索引构造器改为实例字段
- `backup-service.ts`: `importJson` 预加载 pageId Set 和 visitId Set，消除 N+1 查询
- `SettingsTab.tsx`: 添加 `useEffect` 同步外部 settings 变更到本地状态
- `query-parser.ts`: CJK 正则提取为模块级常量，避免每次调用重新创建
- `PopupApp.tsx`: 搜索框添加 300ms debounce，减少不必要的查询
- `content-main.ts`: `thresholdLoaded` 标记移入成功分支，避免失败时 30s 内不重试

**清理（Low）**
- `HistoryTab.tsx`: 删除未使用的 `useState`/`useEffect` 导入和 `PAGE_SIZE` 常量
- `article-extractor.ts`: fallback 路径改用 `innerText` 获取可见文本，避免 `cloneNode(true)` 开销
- `reader-observer.ts`: 移除 tick 中冗余的 title 轮询（已由 MutationObserver 监听）
- 抽取 `rebuildFromDatabase()` 共享方法，`service-worker` 和 `index-recovery` 共用
- `capture-coordinator.ts`: `visit.startedAt` 加 `Math.max(0, ...)` 防御负值

### v0.4.0

**性能优化（P0）**
- `PageRepository.list()` 改用 IndexedDB 索引查询（`lastVisitedAt`/`domain` 索引 + `IDBKeyRange` + 游标分页），替代全表 `getAll` + JS filter
- `PageRepository.getByIds()` 改为单事务批量读取，N 个 `get()` 共享一个 transaction
- `FlexSearchProvider.emptyQueryResults()` 改为轻量路径，不再加载全部页面只为返回 8 条
- `IndexRecovery` 索引重建走 `lastVisitedAt` 索引有序遍历，避免全表 `getAll`
- `RetentionCleaner` 用 `IDBKeyRange.upperBound(cutoff)` 直接定位过期记录，不全量加载
- `BackupService` 导出 visits 改为批量查询（单次 `getAll` + 内存分组），消除 N+1
- `VisitRepository.countByPageId` 改用索引 `count()`，不加载记录数据

**代码质量（P1）**
- 抽取 `renderHighlighted` 到 `ui/highlight.tsx`，SearchTab 和 PopupApp 共用
- 全局替换 `yuehou` → `readtrail`（DB_NAME、backup format、menu ID）
- 删除 `service-worker.ts` 中不可达的 `handleWorkerMessage` `CAPTURE_CANDIDATE` case
- SettingsTab 补齐 `retentionDays`、`searchResultLimit`、`minTextLength` 输入控件
- 修复 QueryParser 时间短语重复 pattern（`最近一周` 出现两次 → 改为 `最近一周|最近7天`）
- `demo-shim.ts` 改为动态 `import()`，构建时不打入生产包
- `blobToBase64` 改用安全实现（分块 `String.fromCharCode.apply`），避免 spread 栈溢出
- 整理 `service-worker.ts` 代码顺序，辅助函数移到使用处之前

**架构增强（P2）**
- 添加 React Error Boundary 组件，包裹 library 和 popup，渲染异常不白屏
- `formatDuration` 支持分钟/小时人类可读格式（`7m30s`、`1h20m`）
- HistoryTab 添加「加载更多」分页按钮
- 域名筛选框添加 debounce（300ms）自动搜索
- Content Script 提前检查 `minTextLength`，避免无谓消息通信
- PreviewModal 添加「展开全文」按钮
- SPA 路由检测补充 `MutationObserver` 监听 title 变化

**测试与工程化（P3）**
- 添加 MessageRouter 单元测试（8 个用例）
- 添加 FlexSearchProvider 单元测试（5 个用例）
- 添加 GitHub Actions CI（typecheck + test + build）
- 添加 ESLint + Prettier 配置

### v0.3.0
- 新增单元测试（vitest，46 个用例），覆盖阈值判定、分词、URL/隐私策略、备份校验
- 修复：超过 2MB 的 JSON 备份无法导入（导入消息上限放宽至 64MB）
- 修复：敏感 URL 判断过宽导致的误判（改为按注册域 + 路径精确匹配），`ref=` 不再误删 `reference=` 等参数
- 修复：不再覆写页面 `history.pushState/replaceState`，SPA 路由改为轮询检测，避免污染宿主页面
- 修复：Service Worker 重启期间自动采集失败后不再丢弃本次阅读，下个周期自动重试
- 变更：总开关关闭时的跳过原因由 `insufficient-reading` 改为独立的 `disabled`

### v0.2.0
- 首个公开版本：自动记录、中文全文检索、独立记录库、隐私保护、备份导入导出

## ❓ 常见问题

**Q: 会被记录吗——我没点扩展图标的时候？**
会。自动记录独立于界面运行，这正是它的设计目标。想停止请用设置页的总开关。

**Q: 我的浏览数据会上传吗？**
不会。整个扩展没有任何网络请求逻辑，所有数据（正文、访问记录、设置）只存在本机浏览器 IndexedDB 中。导出功能是你主动触发的本地文件下载。

**Q: 换电脑/重装浏览器，数据怎么办？**
在记录库导出 JSON 备份，新环境导入即可。注意：以「加载解压缩」方式安装时，扩展 ID 由加载路径决定——同一路径重载/更新数据保留，换了目录则视作新身份，需通过备份迁移。

**Q: 为什么某个页面没被记录？**
依次检查：是否在无痕窗口（永不记录）→ 是否命中敏感域名规则（银行/支付/邮箱/登录）→ 是否已加入排除域名 → 阅读时长/滚动是否达标 → 是否用总开关暂停了。记录库「设置」页可调整全部阈值。

**Q: 和浏览器自带历史记录有什么区别？**
历史记录只存 URL 和标题，无法按内容搜索；ReadTrail 保存**正文全文**，可以用正文里出现过的任何词检索，且提供阅读时长、访问次数、正文预览。

## 🤝 贡献

欢迎 Issue 与 PR。提交前请：

```bash
npm run typecheck   # 通过
npm run build       # 通过
```

## 📄 License

[MIT](LICENSE)

---

<div align="center">
**🔍ReadTrail** — 你读过的每一页，都值得被找回。

</div>
