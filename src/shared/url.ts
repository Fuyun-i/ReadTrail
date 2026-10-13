// ===== URL 规范化与隐私相关 URL 判断（architecture.md 第 7 节）=====

/** 浏览器内部协议页面：不注入、不保存 */
const BROWSER_PROTOCOLS = new Set(['chrome:', 'edge:', 'about:', 'chrome-extension:', 'moz-extension:']);

/** 扩展商店等已知敏感 host 片段 */
const STORE_HOST_PATTERNS = [
  'chromewebstore.google.com',
  'chrome.google.com/webstore',
  'microsoftedge.microsoft.com/addons',
  'microsoftedge.microsoft.com',
];

/**
 * 敏感域名/路径关键词：银行、支付、邮箱、登录、管理后台。
 * 命中任意子串即视为敏感。
 */
const SENSITIVE_FRAGMENTS = [
  // 银行
  'bank',
  'ebank',
  'banking',
  'icbc.com',
  'ccb.com',
  'cmbchina.com',
  'boc.cn',
  'abchina.com',
  'bankcomm.com',
  'psbc.com',
  'cebbank.com',
  'spdb.com',
  'cib.com.cn',
  'cgbchina.com.cn',
  'pab.com.cn',
  'boc.cn',
  // 支付
  'pay.',
  'payment',
  'paypal.com',
  'alipay.com',
  'tenpay.com',
  'stripe.com',
  'checkout.com',
  'skrill.com',
  // 邮箱
  'mail.',
  'mail-',
  'outlook.',
  'hotmail.com',
  'gmail.com',
  'ymail.com',
  'imap',
  'smtp',
  // 登录 / 账户
  'login',
  'signin',
  'sign-in',
  'account.',
  'auth.',
  'passport.',
  'sso.',
  'id.',
  'oauth',
  // 管理后台
  'admin',
  'dashboard',
  'console.',
  'backend',
  'manager.',
  'wp-admin',
];

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

  const TRACKING_PARAM_PREFIXES = ['utm_', 'spm', 'fbclid', 'gclid', 'msclkid', 'yclid', '_ga', 'ref', 'ref_src'];
  const removed: string[] = [];
  url.searchParams.forEach((_value, key) => {
    const lower = key.toLowerCase();
    if (TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p) || lower === p)) {
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
  const host = parsed.host.toLowerCase();
  return STORE_HOST_PATTERNS.some((pattern) => host === pattern || host.endsWith('.' + pattern) || parsed.href.includes(pattern));
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** 判断 URL 是否命中敏感域名/路径关键词 */
export function isSensitiveUrl(url: string): { sensitive: boolean; matchedRule?: string } {
  const lower = url.toLowerCase();
  for (const fragment of SENSITIVE_FRAGMENTS) {
    if (lower.includes(fragment)) {
      return { sensitive: true, matchedRule: fragment };
    }
  }
  return { sensitive: false };
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
