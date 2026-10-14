// ===== 测试全局设置：注入 fake-indexeddb =====
// 在所有数据层测试中提供 IndexedDB 环境（无需浏览器）。
// fake-indexeddb 实现了完整的 IDB API，包括 IDBKeyRange、游标、索引等。

import 'fake-indexeddb/auto';
