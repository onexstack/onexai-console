/**
 * 全站唯一的响应式断点表。
 *
 * # 为什么是 Ant Design 的六档
 *
 * 平台的所有布局组件（Grid / Row / Col / Drawer / Modal）与 `Grid.useBreakpoint`
 * 都按这套阈值工作；Tailwind 的默认值（640 / 768 / 1024 / 1280 / 1536）与之只重合
 * 一个 md，同一份代码里出现两套「平板」语义是这轮移动端改造要消灭的头号问题。
 * 应用侧已通过各 `styles/index.scss` 的 `@theme` 把 Tailwind 前缀对齐到同一组数字。
 *
 * # 语义
 *
 * - `xs` 用的是 `max-width`（antd 的写法），其余是 `min-width`；
 * - 业务代码**只判断 `md`**：`< 768` 是移动端，`768–991` 是平板，`>= 992` 是桌面。
 *   不要在页面里另造 900 / 960 / 1100 之类的阈值。
 *
 * `NavHeader` 里的 1310 / 1160 / 1080 / 955 是**文案宽度驱动的桌面让位**（中英文
 * 文案宽度差约 150px），不是响应式断点，不在这张表里，也不应该被其它地方借用。
 */
export const BREAKPOINTS = {
  xs: 0,
  sm: 576,
  md: 768,
  lg: 992,
  xl: 1200,
  xxl: 1600,
} as const;

export type BreakpointKey = keyof typeof BREAKPOINTS;

export type ScreenMap = Record<BreakpointKey, boolean>;

/** 移动端上界（含）。`< 768` 视为移动端：与 antd 的 `md` 边界逐像素对齐。 */
export const MOBILE_MAX_WIDTH = BREAKPOINTS.md - 1;

/**
 * 与 antd `responsiveObserver` 同形的媒体查询串。
 *
 * `xs` 是 `max-width`，其余是 `min-width` —— 这正是 antd 的判定方式，所以同一个
 * 视口下本表与 `Grid.useBreakpoint()` 的结论一致（见 `breakpoints.test.tsx`）。
 */
export const MEDIA_QUERIES: Record<BreakpointKey, string> = {
  xs: `(max-width: ${BREAKPOINTS.sm - 1}px)`,
  sm: `(min-width: ${BREAKPOINTS.sm}px)`,
  md: `(min-width: ${BREAKPOINTS.md}px)`,
  lg: `(min-width: ${BREAKPOINTS.lg}px)`,
  xl: `(min-width: ${BREAKPOINTS.xl}px)`,
  xxl: `(min-width: ${BREAKPOINTS.xxl}px)`,
};

export const BREAKPOINT_KEYS = Object.keys(BREAKPOINTS) as BreakpointKey[];
