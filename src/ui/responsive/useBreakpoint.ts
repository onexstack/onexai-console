import { useMemo } from 'react';

import {
  BREAKPOINT_KEYS,
  MEDIA_QUERIES,
  MOBILE_MAX_WIDTH,
  type BreakpointKey,
  type ScreenMap,
} from './breakpoints';
import { useMediaQuery } from './useMediaQuery';

/**
 * 当前命中的断点集合，语义与 antd 的 `Grid.useBreakpoint()` 一致。
 *
 * # 为什么不直接包 `Grid.useBreakpoint`
 *
 * antd 的实现首次渲染返回 `{}`（`useRef({})`），`!screens.md` 在桌面首帧会把页面
 * 判成移动端；它的 `defaultScreens` 参数是 escape hatch，但用起来比一个
 * `useSyncExternalStore` 更绕。这里用同一组媒体查询串（见 `MEDIA_QUERIES`），
 * 首帧即正确，且在 jsdom / SSR 下都有确定行为。`breakpoints.test.tsx` 会把
 * 两张表钉在一起，antd 改阈值时测试会红。
 */
export function useBreakpoint(): ScreenMap {
  const xs = useMediaQuery(MEDIA_QUERIES.xs);
  const sm = useMediaQuery(MEDIA_QUERIES.sm);
  const md = useMediaQuery(MEDIA_QUERIES.md);
  const lg = useMediaQuery(MEDIA_QUERIES.lg);
  const xl = useMediaQuery(MEDIA_QUERIES.xl);
  const xxl = useMediaQuery(MEDIA_QUERIES.xxl);

  return useMemo(() => ({ xs, sm, md, lg, xl, xxl }), [xs, sm, md, lg, xl, xxl]);
}

/**
 * 是否处于「移动端」。
 *
 * 默认以 `md` 为界（`< 768`）。传 `'lg'` 可得到「不含平板」的窄屏判定
 * （`< 992`，子应用侧栏用这一档）。
 */
export function useIsMobile(breakpoint: 'md' | 'lg' = 'md'): boolean {
  const screens = useBreakpoint();
  return !screens[breakpoint];
}

/** 是否触屏为主（无 hover、粗指针）。用于把 hover 才出现的操作改为常显。 */
export function useIsTouch(): boolean {
  return useMediaQuery('(hover: none) and (pointer: coarse)');
}

export { MOBILE_MAX_WIDTH };
export type { BreakpointKey, ScreenMap };
export { BREAKPOINT_KEYS };
