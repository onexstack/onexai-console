import { useSyncExternalStore } from 'react';

/**
 * 小型的持久化 UI 状态。
 *
 * 只有三个值（语言、侧栏折叠、业务空间），不值得为此引入 zustand：一个模块级的
 * 订阅集合加上 `useSyncExternalStore` 就够了，而且读写路径一眼能看全。
 *
 * 键名统一带 `onexai-console_` 前缀：这个应用与 OneX 控制台可能同域部署，
 * 两边的偏好不能互相覆盖。
 */

export type Locale = 'zh-CN' | 'en-US';

const LOCALE_KEY = 'onexai-console_locale';
const COLLAPSED_KEY = 'onexai-console_sider_collapsed';
const NAMESPACE_KEY = 'onexai-console_namespace';

/** 空字符串表示「全部空间」。 */
export const ALL_NAMESPACES = '';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 隐私模式 / 配额满：偏好存不住，但本次会话仍应按内存状态工作。
  }
}

function detectInitialLocale(): Locale {
  const stored = read(LOCALE_KEY);
  if (stored === 'zh-CN' || stored === 'en-US') return stored;
  if (typeof navigator === 'undefined') return 'zh-CN';
  return navigator.language.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
}

// ─── 语言 ────────────────────────────────────────────────────────────────────

const localeListeners = new Set<() => void>();
let localeState: Locale = detectInitialLocale();

export function getLocale(): Locale {
  return localeState;
}

export function setLocale(next: Locale): void {
  if (localeState === next) return;
  localeState = next;
  write(LOCALE_KEY, next);
  for (const listener of localeListeners) listener();
}

/** 语言变化（含其它标签页写入）。 */
export function subscribeLocale(listener: () => void): () => void {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

// ─── 侧栏折叠 ────────────────────────────────────────────────────────────────

const collapsedListeners = new Set<() => void>();
let collapsedState = read(COLLAPSED_KEY) === '1';

export function getCollapsed(): boolean {
  return collapsedState;
}

export function setCollapsed(next: boolean): void {
  if (collapsedState === next) return;
  collapsedState = next;
  write(COLLAPSED_KEY, next ? '1' : '0');
  for (const listener of collapsedListeners) listener();
}

export function toggleCollapsed(): void {
  setCollapsed(!collapsedState);
}

export function subscribeCollapsed(listener: () => void): () => void {
  collapsedListeners.add(listener);
  return () => {
    collapsedListeners.delete(listener);
  };
}

export function useCollapsed(): boolean {
  return useSyncExternalStore(subscribeCollapsed, getCollapsed, getCollapsed);
}

// ─── 业务空间（Kubernetes Namespace）────────────────────────────────────────

const namespaceListeners = new Set<() => void>();
let namespaceState: string = (read(NAMESPACE_KEY) ?? ALL_NAMESPACES).trim();

/** 当前业务空间；`ALL_NAMESPACES`（空字符串）表示不过滤。 */
export function getNamespace(): string {
  return namespaceState;
}

export function setNamespace(next: string): void {
  const value = next.trim();
  if (namespaceState === value) return;
  namespaceState = value;
  write(NAMESPACE_KEY, value);
  for (const listener of namespaceListeners) listener();
}

/** 业务空间变化（含其它标签页写入）。 */
export function subscribeNamespace(listener: () => void): () => void {
  namespaceListeners.add(listener);
  return () => {
    namespaceListeners.delete(listener);
  };
}

export function useNamespace(): string {
  return useSyncExternalStore(subscribeNamespace, getNamespace, getNamespace);
}

// ─── 跨标签页同步 ────────────────────────────────────────────────────────────

/** 在应用启动时注册一次：其它标签页改了语言或折叠状态，这里跟着更新。 */
export function setupStorageSync(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === LOCALE_KEY) {
      const stored = read(LOCALE_KEY);
      if (stored === 'zh-CN' || stored === 'en-US') {
        localeState = stored;
        for (const listener of localeListeners) listener();
      }
    }
    if (event.key === COLLAPSED_KEY) {
      collapsedState = read(COLLAPSED_KEY) === '1';
      for (const listener of collapsedListeners) listener();
    }
    if (event.key === NAMESPACE_KEY) {
      namespaceState = (read(NAMESPACE_KEY) ?? ALL_NAMESPACES).trim();
      for (const listener of namespaceListeners) listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
