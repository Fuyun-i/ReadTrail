// ===== 隐私策略（architecture.md 第 7 节）=====

import type { SkipReason, UserSettings } from '../shared/types';
import { isBrowserPage, extractDomain, isSensitiveUrl, getRegistrableDomain } from '../shared/url';

export type PrivacyInput = {
  url: string;
  isIncognito: boolean;
  title?: string;
};

export type PrivacyDecision = {
  allowed: boolean;
  reason?: SkipReason;
  matchedRule?: string;
};

export class PrivacyPolicy {
  constructor(private getSettings: () => Promise<UserSettings>) {}

  async evaluate(input: PrivacyInput): Promise<PrivacyDecision> {
    // 1. 无痕窗口：最高优先级，不可被允许列表覆盖（P-009）
    if (input.isIncognito) {
      return { allowed: false, reason: 'private-window', matchedRule: 'incognito' };
    }

    // 2. 浏览器内部页面与扩展商店
    if (isBrowserPage(input.url)) {
      return { allowed: false, reason: 'browser-page', matchedRule: 'browser-protocol' };
    }

    // 3. 敏感域名 / 路径（银行、支付、邮箱、登录、后台）
    const sensitive = isSensitiveUrl(input.url);
    if (sensitive.sensitive) {
      // 敏感规则不可被允许列表覆盖
      return { allowed: false, reason: 'sensitive-domain', matchedRule: sensitive.matchedRule };
    }

    const settings = await this.getSettings();

    // 4. 总开关（E-021）：暂停自动记录对所有普通站点生效，允许列表不能绕过；
    //    手动保存走 evaluateManual，不受此限制
    if (!settings.enabled) {
      return { allowed: false, reason: 'disabled', matchedRule: 'disabled' };
    }

    const domain = extractDomain(input.url);
    const registrable = getRegistrableDomain(domain);

    // 5. 用户允许列表：可覆盖普通排除规则（P-008）
    const included = matchList(settings.includedDomains, domain, registrable);
    if (included) {
      return { allowed: true, matchedRule: `include:${included}` };
    }

    // 6. 用户排除域名（P-007）
    const excluded = matchList(settings.excludedDomains, domain, registrable);
    if (excluded) {
      return { allowed: false, reason: 'excluded-domain', matchedRule: `exclude:${excluded}` };
    }

    return { allowed: true };
  }

  /** 手动保存也走此检查，但允许列表不能覆盖无痕与敏感规则 */
  async evaluateManual(input: PrivacyInput): Promise<PrivacyDecision> {
    if (input.isIncognito) {
      return { allowed: false, reason: 'private-window', matchedRule: 'incognito' };
    }
    if (isBrowserPage(input.url)) {
      return { allowed: false, reason: 'browser-page', matchedRule: 'browser-protocol' };
    }
    const sensitive = isSensitiveUrl(input.url);
    if (sensitive.sensitive) {
      return { allowed: false, reason: 'sensitive-domain', matchedRule: sensitive.matchedRule };
    }
    // 手动保存不受排除域名与总开关限制
    return { allowed: true, matchedRule: 'manual-override' };
  }
}

function matchList(list: string[], domain: string, registrable: string): string | undefined {
  for (const entry of list) {
    const e = entry.toLowerCase().replace(/^www\./, '');
    if (!e) continue;
    if (domain === e || domain.endsWith('.' + e) || registrable === e) {
      return entry;
    }
  }
  return undefined;
}
