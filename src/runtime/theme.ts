import { useSyncExternalStore } from 'react';

import {
  applyThemeToDocument,
  currentThemeState,
  getSystemTheme,
  isThemePreference,
  readThemePreference,
  resolveThemePreference,
  THEME_CHANGE_EVENT,
  THEME_REQUEST_EVENT,
  THEME_STORAGE_KEY,
  watchSystemTheme,
  writeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
  type ThemeState,
} from '@/lib/theme';
import { getWujieProps, isInWujie, onWujieEvent, emitWujieEvent } from './wujie';

/**
 * 主题状态。
 *
 * # 两种运行形态
 *
 * - **Wujie 内**：宿主是唯一写入方。初始值从 `props.theme` 拿，运行期变化走 bus
 *   的 `theme:change`；注册监听后再发一次 `theme:request`，覆盖「用户在子应用
 *   加载期间改了主题」的竞态。
 * - **独立运行**：自己读 `onex-theme-preference`，监听系统明暗与其它标签页。
 *
 * 无论哪种形态，最终都把 `data-theme` / `color-scheme` 写进自己的 document，
 * 并让 antd 用 `resolved` 建主题。
 */

/** 类型守卫：props 来自沙箱，不能按类型系统相信它。 */
function isThemeState(value: unknown): value is ThemeState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<ThemeState>;
  return (
    isThemePreference(state.preference) && (state.resolved === 'light' || state.resolved === 'dark')
  );
}

function initialState(): ThemeState {
  if (typeof window !== 'undefined' && isInWujie()) {
    const props = getWujieProps<{ theme?: unknown }>();
    if (isThemeState(props?.theme)) return props.theme;
  }
  return currentThemeState();
}

const listeners = new Set<() => void>();
let state: ThemeState = initialState();

function emit(): void {
  for (const listener of listeners) listener();
}

function apply(next: ThemeState): void {
  if (state.preference === next.preference && state.resolved === next.resolved) return;
  state = next;
  applyThemeToDocument(next.resolved, next.preference);
  emit();
}

export function getThemeState(): ThemeState {
  return state;
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThemeState(): ThemeState {
  return useSyncExternalStore(subscribeTheme, getThemeState, getThemeState);
}

/** 独立运行时的用户选择（Wujie 内不使用：宿主是唯一写入方）。 */
export function setThemePreference(preference: ThemePreference): void {
  writeThemePreference(preference);
  apply({ preference, resolved: resolveThemePreference(preference, getSystemTheme()) });
}

/** 在明暗之间切换（跟随系统的下一次点击会落到实际解析出的那一档的反面）。 */
export function toggleTheme(): void {
  const next: ResolvedTheme = state.resolved === 'dark' ? 'light' : 'dark';
  setThemePreference(next);
}

/**
 * 启动同步通道，返回清理函数。在 React 挂载前调用一次。
 */
export function initThemeSync(): () => void {
  applyThemeToDocument(state.resolved, state.preference);

  if (typeof window !== 'undefined' && isInWujie()) {
    const props = getWujieProps<{ theme?: unknown }>();
    if (isThemeState(props?.theme)) apply(props.theme);

    const off = onWujieEvent(THEME_CHANGE_EVENT, (...args: unknown[]) => {
      const payload = args[0];
      if (isThemeState(payload)) apply(payload);
    });
    emitWujieEvent(THEME_REQUEST_EVENT);
    return off;
  }

  const offSystem = watchSystemTheme(() => {
    // 系统变化只影响「跟随系统」档；固定档不该因为系统切换而重渲染。
    if (readThemePreference() === 'system') apply(currentThemeState());
  });

  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) apply(currentThemeState());
  };
  window.addEventListener('storage', onStorage);

  return () => {
    offSystem();
    window.removeEventListener('storage', onStorage);
  };
}
