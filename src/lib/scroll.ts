/**
 * 滚动相关的 DOM 工具。
 */

/**
 * 最近的可滚动祖先：控制台里通常是 `PageLayout` 的 `.body`，侧栏里是 `aside`。
 *
 * 从 `parentElement` 开始找，不检查节点自身：步骤条这类元素带 `overflow-x: auto`，
 * CSS 的 overflow 联动会把未声明的 `overflow-y` 也算成 `auto`，从自身开始会
 * 错误地把它当成滚动容器。
 */
export function findScrollParent(node: Element | null): HTMLElement | null {
  let parent = node?.parentElement ?? null;
  while (parent) {
    const { overflowY } = window.getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll') return parent;
    parent = parent.parentElement;
  }
  return null;
}

/**
 * 把元素所在的滚动容器滚回顶部。
 *
 * 用于「切步 / 切阶段后回到内容起点」：容器自身的 padding 与卡片的内边距都
 * 因此保留在视口里，不会像 `scrollIntoView({ block: 'start' })` 那样把页头下方的
 * 灰底间距、卡片边框和内边距一起滚掉。
 *
 * 元素没有布局（父级 `hidden` / `display: none`）时直接返回：隐藏状态下不该
 * 触发滚动，否则切回可见区域时页面会莫名其妙地跳一下。
 */
export function scrollToTopOf(node: HTMLElement | null): void {
  if (!node || node.getClientRects().length === 0) return;
  const parent = findScrollParent(node);
  if (parent) parent.scrollTop = 0;
}
