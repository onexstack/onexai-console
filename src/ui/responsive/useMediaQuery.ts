import { useCallback, useSyncExternalStore } from 'react';

/**
 * 查询串里写死的 `min-width` / `max-width` 阈值。
 *
 * 只在**没有 `matchMedia`** 的环境里用到：SSR 与 jsdom。jsdom 没有实现
 * `window.matchMedia`，而组件库的大量单测跑在 jsdom 里；如果这里一律返回 `false`，
 * `useIsMobile()` 会在测试里恒为真，所有桌面分支的断言会集体反转 —— 这种「测试环境
 * 冒充手机」的错误比不测更难发现。
 */
const MIN_WIDTH_RE = /min-width:\s*(\d+)px/;
const MAX_WIDTH_RE = /max-width:\s*(\d+)px/;

/**
 * 当前环境的 `matchMedia` 是否真的可用。
 *
 * jsdom **会**定义 `window.matchMedia`，但它是个永远返回 `matches: false` 的桩 ——
 * 只判断「函数存在」会把所有单测都判成移动端，桌面分支的断言会集体反转。
 * 用一条必然为真的查询探测：真实浏览器里 `(min-width: 0px)` 恒真，jsdom 的桩返回
 * false。结果缓存一次，避免每次渲染多做一次 matchMedia。
 */
let matchMediaSupported: boolean | undefined;

function supportsMatchMedia(): boolean {
  if (matchMediaSupported !== undefined) return matchMediaSupported;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    matchMediaSupported = false;
    return false;
  }
  try {
    matchMediaSupported = window.matchMedia('(min-width: 0px)').matches === true;
  } catch {
    matchMediaSupported = false;
  }
  return matchMediaSupported;
}

/** 查询串是否命中（无可用 `matchMedia` 时按 `innerWidth` 估算）。 */
export function evaluateMediaQuery(query: string): boolean {
  // 没有 window = SSR / 构建期：按桌面处理 —— `min-width` 全真、`max-width`（xs）
  // 与触屏查询全假，于是 `useIsMobile()` 恒为 false，不会把服务端渲染成手机版。
  if (typeof window === 'undefined') return query.includes('min-width');

  if (supportsMatchMedia()) return window.matchMedia(query).matches;

  const width = window.innerWidth || 1024;
  const max = MAX_WIDTH_RE.exec(query);
  if (max) return width <= Number(max[1]);
  const min = MIN_WIDTH_RE.exec(query);
  if (min) return width >= Number(min[1]);
  return false;
}

/**
 * 订阅一条媒体查询。
 *
 * 用 `useSyncExternalStore` 而不是 `useEffect + setState`：后者的首帧一定拿到
 * 初始值，桌面用户会先看到一帧移动端布局再跳回来。这里在**提交前**就读到真实值。
 *
 * 返回值在 `matchMedia` 不存在时由 `evaluateMediaQuery` 按视口宽估算，因此
 * 单测环境不会把所有人当成手机。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!supportsMatchMedia()) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => evaluateMediaQuery(query), [query]);

  // 第三参（server snapshot）只在 SSR / hydration 用；与 client 首帧取同一个估算，
  // 不会出现「服务端桌面、客户端手机」的水合不一致。
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
