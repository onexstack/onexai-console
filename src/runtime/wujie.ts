import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Wujie 微前端入口。
 *
 * 本应用默认独立运行；被 OneX 宿主以 Wujie 嵌入时（`window.__POWERED_BY_WUJIE__`），
 * 挂载与卸载由宿主驱动，路由改用 `MemoryRouter`，前缀由宿主 props 的 `basePath`
 * 决定。独立运行（含 iframe 嵌入）走 `BrowserRouter`，这段只负责直接挂载。
 */

export interface WujieEntryOptions {
  /** 根元素 ID，默认 `root` */
  rootId?: string;
  /** 可选的额外挂载回调 */
  onMount?: () => void;
  /** 可选的卸载回调 */
  onUnmount?: () => void;
}

/** 创建应用入口：Wujie 内注册生命周期，否则直接挂载。 */
export function createWujieEntry(options: WujieEntryOptions & { render: () => ReactNode }): void {
  const { rootId = 'root', render, onMount, onUnmount } = options;

  let root: Root | null = null;

  function mount(): void {
    const container = document.getElementById(rootId);
    if (!container) {
      console.error(`[Wujie Entry] Container element with id "${rootId}" not found`);
      return;
    }
    onMount?.();
    root = createRoot(container);
    root.render(render());
  }

  function unmount(): void {
    root?.unmount();
    root = null;
    onUnmount?.();
  }

  if (typeof window !== 'undefined' && window.__POWERED_BY_WUJIE__) {
    window.__WUJIE_MOUNT = mount;
    window.__WUJIE_UNMOUNT = unmount;
  } else {
    mount();
  }
}

/** 是否在 Wujie 环境中运行。 */
export function isInWujie(): boolean {
  return typeof window !== 'undefined' && !!window.__POWERED_BY_WUJIE__;
}

/** 获取 Wujie 传递的 Props。 */
export function getWujieProps<T extends Record<string, unknown> = Record<string, unknown>>(): T | null {
  const props = window.$wujie?.props;
  return props ? (props as T) : null;
}

/**
 * 获取子应用的路由信息。
 *
 * `hostOrigin` 是**宿主**的 origin，由宿主显式传下来——沙箱里 `window.location`
 * 是子应用自己的地址，算不出宿主那边 `/app/<名字>/…` 的完整地址。
 * 独立运行时三个值都为空。
 */
export function getWujieRouteInfo(): { basePath: string; subPath: string; hostOrigin: string } {
  const props = getWujieProps();
  return {
    basePath: (props?.['basePath'] as string) || '',
    subPath: (props?.['subPath'] as string) || '/',
    hostOrigin: (props?.['hostOrigin'] as string) || '',
  };
}

/** 订阅 Wujie 事件（非 Wujie 环境返回空清理函数）。 */
export function onWujieEvent(event: string, callback: (...args: unknown[]) => void): () => void {
  const bus = window.$wujie?.bus;
  if (bus) {
    bus.$on(event, callback);
    return () => bus.$off(event, callback);
  }
  return () => {};
}

/** 发送 Wujie 事件（非 Wujie 环境静默忽略）。 */
export function emitWujieEvent(event: string, ...args: unknown[]): void {
  window.$wujie?.bus?.$emit(event, ...args);
}
