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

`tests/` 目录覆盖核心纯逻辑模块：

- 阅读阈值判定（`reading-threshold`）
- 查询解析与 CJK 分词（`query-parser`）
- URL 规范化 / 敏感 URL / 浏览器内部页判断（`url`）
- 备份导入导出校验（`backup-service`）
- 隐私策略（自动与手动保存的例外规则）
- 消息路由（`message-router`）
- 搜索提供者（`search-provider`）

提交前请保证 `npm run typecheck` 与 `npm test` 全部通过。

## 📋 更新日志

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
