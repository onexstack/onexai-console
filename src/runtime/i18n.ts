import i18n, { type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';

import type { Locale } from './store';

export interface I18nConfig {
  defaultLocale: Locale;
  resources: Record<string, { translation: Record<string, unknown> }>;
}

let initialized = false;

/**
 * 初始化 i18next 单例。
 *
 * 必须在 `root.render()` 之前调用：`AppShell` 子树的 `i18n.changeLanguage`
 * 执行时实例要已就绪。
 */
export function initI18n(config: I18nConfig): typeof i18n {
  if (!initialized) {
    i18n.use(initReactI18next).init({
      resources: config.resources as unknown as Resource,
      lng: config.defaultLocale,
      fallbackLng: config.defaultLocale,
      interpolation: {
        // React 已经做 XSS 防护，不需要 i18next 再转义。
        escapeValue: false,
      },
      react: {
        // 关闭 Suspense：未就绪时先返回 key，就绪后由 useTranslation 触发重渲染。
        useSuspense: false,
      },
    });
    initialized = true;
  }
  return i18n;
}

/** 切换语言，并同步 antd 语言包（由 AppShell 的 effect 调用）。 */
export async function changeLocale(locale: Locale): Promise<void> {
  if (i18n.isInitialized && i18n.language !== locale) {
    await i18n.changeLanguage(locale);
  }
}

/**
 * Wujie 内跟随宿主的语言切换（宿主广播 `onex-web:locale:change`）。
 * 独立运行时不需要——本应用自己的语言选择器就是唯一来源。
 */
export function setupLocaleSync(onChange: (locale: Locale) => void): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('onex-web:locale:change', ((e: Event) => {
    const locale = (e as CustomEvent<{ locale?: string }>).detail?.locale;
    if (locale === 'zh-CN' || locale === 'en-US') onChange(locale);
  }) as EventListener);
}

export { i18n };
export { useTranslation } from 'react-i18next';
