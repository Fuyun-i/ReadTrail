import { describe, it, expect } from 'vitest';
import { canonicalizeUrl, isSensitiveUrl, isBrowserPage, getRegistrableDomain } from '../src/shared/url';

describe('canonicalizeUrl', () => {
  it('去除 hash', () => {
    expect(canonicalizeUrl('https://a.com/x#section')).toBe('https://a.com/x');
  });

  it('移除跟踪参数', () => {
    expect(canonicalizeUrl('https://a.com/x?utm_source=rss&id=1')).toBe('https://a.com/x?id=1');
  });

  it('移除纯空查询串', () => {
    expect(canonicalizeUrl('https://a.com/x?')).toBe('https://a.com/x');
  });

  it('ref 参数删除但不误删 reference', () => {
    // ref is a legitimate navigation param, not tracking — should be preserved
    expect(canonicalizeUrl('https://a.com/x?ref=news&reference=book')).toBe('https://a.com/x?ref=news&reference=book');
  });

  it('非法 URL 原样返回', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url');
  });
});

describe('isSensitiveUrl', () => {
  it('命中支付与登录域名', () => {
    expect(isSensitiveUrl('https://paypal.com/x').sensitive).toBe(true);
    expect(isSensitiveUrl('https://github.com/login').sensitive).toBe(true);
  });

  it('普通内容页不误判', () => {
    expect(isSensitiveUrl('https://example.com/post/valid-guide').sensitive).toBe(false);
    expect(isSensitiveUrl('https://blog.example.com/my-article').sensitive).toBe(false);
    expect(isSensitiveUrl('https://a.com/how-to-use-payword').sensitive).toBe(false);
  });
});

describe('isBrowserPage', () => {
  it('内部协议命中', () => {
    expect(isBrowserPage('chrome://settings')).toBe(true);
    expect(isBrowserPage('chrome://settings')).toBe(true);
    expect(isBrowserPage('edge://extensions')).toBe(true);
  });

  it('扩展商店命中', () => {
    expect(isBrowserPage('https://chromewebstore.google.com/detail/xyz')).toBe(true);
  });

  it('普通 https 页不命中', () => {
    expect(isBrowserPage('https://example.com')).toBe(false);
  });

  it('无法解析的 URL 视为浏览器页', () => {
    expect(isBrowserPage('::::')).toBe(true);
  });
});

describe('getRegistrableDomain', () => {
  it('多段后缀取三段', () => {
    expect(getRegistrableDomain('www.example.com.cn')).toBe('example.com.cn');
    expect(getRegistrableDomain('a.b.co.uk')).toBe('b.co.uk');
  });

  it('普通域名取两段', () => {
    expect(getRegistrableDomain('www.example.com')).toBe('example.com');
    expect(getRegistrableDomain('example.com')).toBe('example.com');
  });
});
