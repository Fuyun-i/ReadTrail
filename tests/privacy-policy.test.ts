import { describe, it, expect } from 'vitest';
import { PrivacyPolicy } from '../src/background/privacy-policy';
import type { UserSettings } from '../src/shared/types';

const baseSettings: UserSettings = {
  enabled: true,
  minReadingDurationMs: 10_000,
  minScrollRatio: 0.25,
  minTextLength: 300,
  excludedDomains: ['excluded.com'],
  includedDomains: [],
  searchResultLimit: 30,
};

function policy(overrides: Partial<UserSettings> = {}) {
  return new PrivacyPolicy(async () => ({ ...baseSettings, ...overrides }));
}

describe('PrivacyPolicy.evaluate', () => {
  it('无痕窗口永不记录，且允许列表不能覆盖', async () => {
    const p = policy({ includedDomains: ['incognito-site.com'] });
    const d = await p.evaluate({ url: 'https://incognito-site.com/a', isIncognito: true });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('private-window');
  });

  it('浏览器内部页拒绝', async () => {
    const d = await policy().evaluate({ url: 'chrome://settings', isIncognito: false });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('browser-page');
  });

  it('敏感域名拒绝，允许列表不能覆盖', async () => {
    const p = policy({ includedDomains: ['paypal.com'] });
    const d = await p.evaluate({ url: 'https://paypal.com/x', isIncognito: false });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('sensitive-domain');
  });

  it('总开关关闭时普通站点拒绝，但子域名匹配排除表', async () => {
    const d = await policy({ enabled: false }).evaluate({ url: 'https://blog.example.com/a', isIncognito: false });
    expect(d.allowed).toBe(false);
  });

  it('排除域名（含子域名）拒绝', async () => {
    const d = await policy().evaluate({ url: 'https://www.excluded.com/a', isIncognito: false });
    expect(d.allowed).toBe(false);
    expect(d.matchedRule).toContain('excluded.com');
  });

  it('允许列表覆盖排除域名', async () => {
    const p = policy({ includedDomains: ['excluded.com'] });
    const d = await p.evaluate({ url: 'https://sub.excluded.com/a', isIncognito: false });
    expect(d.allowed).toBe(true);
  });

  it('普通站点允许', async () => {
    const d = await policy().evaluate({ url: 'https://example.com/article', isIncognito: false });
    expect(d.allowed).toBe(true);
  });
});

describe('PrivacyPolicy.evaluateManual', () => {
  it('手动保存无视总开关与排除域名', async () => {
    const p = policy({ enabled: false, excludedDomains: ['excluded.com'] });
    expect((await p.evaluateManual({ url: 'https://excluded.com/a', isIncognito: false })).allowed).toBe(true);
    expect((await p.evaluateManual({ url: 'https://any.com/a', isIncognito: false })).allowed).toBe(true);
  });

  it('手动保存仍不可覆盖无痕/敏感/内部页', async () => {
    const p = policy();
    expect((await p.evaluateManual({ url: 'https://paypal.com', isIncognito: false })).allowed).toBe(false);
    expect((await p.evaluateManual({ url: 'https://a.com', isIncognito: true })).allowed).toBe(false);
    expect((await p.evaluateManual({ url: 'edge://extensions', isIncognito: false })).allowed).toBe(false);
  });
});
