/**
 * 主题偏好（亮 / 暗 / 跟随系统）
 *
 * 这里是主题的**唯一一份运行时实现**：宿主应用、子应用运行时、首帧内联脚本
 * （`@onex-console/app-config` 的 `theme-bootstrap.ts`）都按同一套键名与语义工作。
 *
 * 明暗只有一个真源：`<html data-theme>`。本模块只负责「读写偏好」与「把有效主题
 * 写到文档上」，不碰 React、不碰 antd —— 组件层各自按需消费。
 */

/** 用户选择的档位 */
export type ThemePreference = 'light' | 'dark' | 'system';

/** 解析后的实际主题（`system` 已按系统偏好落成亮或暗） */
export type ResolvedTheme = 'light' | 'dark';

/**
 * 一份完整的状态快照：档位 + 解析结果。
 *
 * 宿主通过 Wujie props 与 bus 发给子应用的就是它——子应用首帧需要 `resolved`
 * 才能建 antd 主题，而菜单里显示的是 `preference`，两者都要，且必须来自同一时刻。
 */
export interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

/**
 * 偏好存储键。
 *
 * 刻意**独立于** zustand 的 `onex-console-app-storage`：首帧内联脚本必须能直接读它，
 * 让脚本去解析一个带版本号的 JSON blob 等于把 store 的内部实现变成 HTML 契约。
 * 旧缓存里本来也没存过 theme，所以不存在需要迁移的历史值。
 */
export const THEME_STORAGE_KEY = 'onex-theme-preference';

/** Wujie 事件总线：宿主 → 子应用的主题变化 */
export const THEME_CHANGE_EVENT = 'theme:change';

/** Wujie 事件总线：子应用 → 宿主的补漏请求（覆盖加载期变化） */
export const THEME_REQUEST_EVENT = 'theme:request';

/** 没存过选择时的默认档位：跟随系统，与 `/kb/` 阅读页一致 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/** 是否是一个合法的档位值 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * 读取用户选择。
 *
 * 存储不可用（隐私模式、SSR、测试环境）或值非法时回退到 `system`，而不是抛错——
 * 主题读不出来不应该让整页挂掉。
 */
export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** 写入用户选择。存储不可用时静默失败（本次会话仍然按内存状态工作）。 */
export function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // 隐私模式 / 配额满：偏好存不住，但当前页面仍应正确切换。
  }
}

/** 系统此刻的偏好；没有 matchMedia 时按亮色。 */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 把档位落成实际主题。`system` 交给 `system` 参数（默认现读系统）。 */
export function resolveThemePreference(
  preference: ThemePreference,
  system: ResolvedTheme = getSystemTheme()
): ResolvedTheme {
  if (preference === 'system') return system;
  return preference;
}

/** 以当前存储 + 当前系统偏好拼一份状态快照。 */
export function currentThemeState(): ThemeState {
  const preference = readThemePreference();
  return { preference, resolved: resolveThemePreference(preference) };
}

/**
 * 把有效主题写到文档上。
 *
 * - `data-theme`：样式与岛读的**唯一真源**（与 `/kb/` 阅读页的语义一致）；
 * - `data-theme-source`：`user` / `system`，只用于诊断与调试，CSS 不依赖它；
 * - `colorScheme`：让滚动条、表单控件等原生 UI 一起翻，不然暗色页里会挂着一截亮色滚动条。
 */
export function applyThemeToDocument(resolved: ResolvedTheme, preference?: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  if (preference) {
    root.setAttribute('data-theme-source', preference === 'system' ? 'system' : 'user');
  }
  root.style.colorScheme = resolved;
}

/**
 * 监听系统明暗变化，返回取消函数。
 *
 * 调用方自行决定要不要在 `preference !== 'system'` 时忽略通知——本函数只负责把
 * 系统事实送出去。
 */
export function watchSystemTheme(callback: (resolved: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (event: MediaQueryListEvent) => callback(event.matches ? 'dark' : 'light');

  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
