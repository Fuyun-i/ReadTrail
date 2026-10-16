// ===== URL 规范化与隐私相关 URL 判断（architecture.md 第 7 节）=====

/** 浏览器内部协议页面：不注入、不保存 */
const BROWSER_PROTOCOLS = new Set(['chrome:', 'edge:', 'about:', 'chrome-extension:', 'moz-extension:']);

/** 扩展商店等已知敏感 host（纯域名） */
const STORE_HOSTS = new Set([
  'chromewebstore.google.com',
  'chrome.google.com',
  'microsoftedge.microsoft.com',
]);

/** 扩展商店等已知敏感 host + path 前缀 */
const STORE_HOST_PATHS: Array<{ host: string; path: string }> = [
  { host: 'chrome.google.com', path: '/webstore' },
  { host: 'microsoftedge.microsoft.com', path: '/addons' },
];

/**
 * 敏感 host 精确/后缀匹配：银行、支付、邮箱等按注册域判断，
 * 避免子串误判（如 `id.` 命中 `valid.com`、`pay.` 命中 `payload.xxx`）。
 * 登录/后台类路径特征单独匹配 pathname。
 */
const SENSITIVE_HOSTS = new Set([
  // 银行
  'icbc.com.cn', 'ccb.com', 'cmbchina.com', 'boc.cn', 'abchina.com',
  'bankcomm.com', 'psbc.com', 'cebbank.com', 'spdb.com', 'cib.com.cn',
  'cgbchina.com.cn', 'pab.com.cn',
  // 支付
  'paypal.com', 'alipay.com', 'tenpay.com', 'stripe.com', 'checkout.com', 'skrill.com',
  // 邮箱
  'gmail.com', 'hotmail.com', 'outlook.com', 'outlook.office.com', 'ymail.com',
  'mail.qq.com', 'mail.163.com', 'mail.126.com', 'mail.sina.com.cn',
]);

/** host 片段正则匹配：命中即敏感（如所有 *.bank.* / *.ebank.* 域）
 *  使用标签边界正则避免误判（foodbank / databank 等不会命中） */
const SENSITIVE_HOST_FRAGMENT_PATTERNS = [
  /^bank\./i, /\.bank\./i, /^ebank\./i, /\.ebank\./i, /^banking\./i, /\.banking\./i,
];

/** 登录 / 账户 / 管理后台：按路径关键词匹配 */
const SENSITIVE_PATH_FRAGMENTS = [
  '/login', '/signin', '/sign-in', '/signup', '/register',
  '/oauth', '/sso/', '/passport', '/wp-login', '/wp-admin',
  '/dashboard', '/admin',
];

/**
 * 判断 URL 是否命中敏感域名/路径关键词。
 * host 按「注册域 + 后缀片段」匹配，路径按关键词匹配，避免普通内容页误判。
 */
export function isSensitiveUrl(url: string): { sensitive: boolean; matchedRule?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { sensitive: false };
  }

  const host = parsed.hostname.toLowerCase();
  const registrable = getRegistrableDomain(host);

  if (SENSITIVE_HOSTS.has(host) || SENSITIVE_HOSTS.has(registrable)) {
    return { sensitive: true, matchedRule: host };
  }
  // host 片段：如 news.bank.example.com / my.ebank.cn（标签边界匹配，避免 foodbank 等误判）
  for (const pattern of SENSITIVE_HOST_FRAGMENT_PATTERNS) {
    if (pattern.test(host)) {
      return { sensitive: true, matchedRule: pattern.source };
    }
  }
  const path = parsed.pathname.toLowerCase();
  for (const fragment of SENSITIVE_PATH_FRAGMENTS) {
    // 精确路径段匹配：path === fragment 或以 fragment + / 开头，避免 /administrator 误命中 /admin
    if (path === fragment || path.startsWith(fragment + '/')) {
      return { sensitive: true, matchedRule: fragment };
    }
  }
  return { sensitive: false };
}

/**
 * 规范化 URL：
 * - 去除 hash
 * - 移除常见跟踪参数（utm_*, fbclid, gclid, spm 等）
 * - 移除尾部斜杠（仅路径为 "/" 时保留 host）
 */
export function canonicalizeUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  url.hash = '';

  const TRACKING_PARAM_PREFIXES = ['utm_', 'spm', 'fbclid', 'gclid', 'msclkid', 'yclid', '_ga', 'ref=', 'ref_src'];
  const removed: string[] = [];
  url.searchParams.forEach((_value, key) => {
    const lower = key.toLowerCase();
    // `ref=` 带等号，避免误删 reference / refresh 等正常参数
    if (TRACKING_PARAM_PREFIXES.some((p) => (p.endsWith('=') ? lower === p.slice(0, -1) : lower.startsWith(p)))) {
      removed.push(key);
    }
  });
  removed.forEach((key) => url.searchParams.delete(key));

  let result = url.toString();
  // 去掉仅剩的 "?"
  if (result.endsWith('?')) {
    result = result.slice(0, -1);
  }
  return result;
}

export function isBrowserPage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // 无法解析的 URL 一律视为浏览器页处理
    return true;
  }
  if (BROWSER_PROTOCOLS.has(parsed.protocol)) return true;
  const host = parsed.hostname.toLowerCase();
  // 纯域名匹配（含子域）
  if (STORE_HOSTS.has(host) || [...STORE_HOSTS].some((h) => host.endsWith('.' + h))) return true;
  // 域名 + 路径前缀匹配
  return STORE_HOST_PATHS.some(({ host: h, path }) =>
    (host === h || host.endsWith('.' + h)) && parsed.pathname.startsWith(path),
  );
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** 提取注册域（简易版：处理常见双段后缀） */
const MULTI_PART_SUFFIXES = new Set([
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'co.jp', 'ne.jp', 'or.jp',
  'com.hk', 'com.tw', 'com.au', 'com.br', 'com.sg', 'com.kr',
]);

export function getRegistrableDomain(hostname: string): string {
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}
