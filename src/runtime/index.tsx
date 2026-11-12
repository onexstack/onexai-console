import { AppShell } from './AppShell';
import { initI18n } from './i18n';
import { createWujieEntry } from './wujie';
import type { AppConfig } from './types';

export { defineConfig } from './types';
export type {
  AppConfig,
  LayoutConfig,
  MenuItem,
  RouteConfig,
  RouteMeta,
  ThemeConfig,
} from './types';

export { AppShell } from './AppShell';
export { DefaultLayout } from './DefaultLayout';
export {
  AppConfigProvider,
  useAppConfig,
  useGoBack,
  useLinkHandler,
  type LinkHandler,
} from './hooks';
export {
  ALL_NAMESPACES,
  getLocale,
  getNamespace,
  setLocale,
  setNamespace,
  toggleCollapsed,
  useCollapsed,
  useLocale,
  useNamespace,
} from './store';
export { useThemeState, setThemePreference, toggleTheme } from './theme';
export { getWujieRouteInfo, isInWujie } from './wujie';
export { changeLocale, initI18n, useTranslation } from './i18n';

/**
 * 创建应用。
 *
 * 在 `root.render()` 之前初始化 i18n：`AppShell` 子树里的
 * `i18n.changeLanguage` 执行时实例必须已就绪。
 */
export function createApp(config: AppConfig): void {
  initI18n(config.i18n);
  createWujieEntry({ render: () => <AppShell config={config} /> });
}
