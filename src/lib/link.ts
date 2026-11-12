/**
 * 带修饰键的点击（⌘/Ctrl/中键 → 新标签，Shift → 新窗口）。
 *
 * 与 onex-console 的 `@onex-console/utils` 同源（2026-11-06 拆分时抽取）：
 * 判据只有一份，宿主与独立应用不该各写一套。
 *
 * 刻意不引 React 的 `MouseEvent` 类型：原生 `MouseEvent` 与 React 合成事件在
 * 这几个字段上形状相同，两者都能原样传进来。
 */

export interface ModifiedClickLike {
  /** `0` 左键、`1` 中键、`2` 右键；缺省按左键算。 */
  button?: number;
  /** mac 的 ⌘。 */
  metaKey?: boolean;
  /** Windows / Linux 的 Ctrl。 */
  ctrlKey?: boolean;
  /** Shift —— 与浏览器对 `<a>` 的约定一致：开独立窗口而不是标签页。 */
  shiftKey?: boolean;
}

/** 一次点击事件的最小形状：修饰键、按键，加上两处 DOM 信息。 */
export interface LinkClickEvent extends ModifiedClickLike {
  /** 事件**绑在哪个元素上**。React 与原生 DOM 都提供这个字段。 */
  currentTarget?: unknown;
  preventDefault?: () => void;
}

/** 这次点击该由浏览器开什么：`'tab'` 新标签页、`'window'` 独立窗口、`null` 不新开。 */
function modifiedClickTarget(e: ModifiedClickLike): 'tab' | 'window' | null {
  if (e.button === 1) return 'tab';
  if (e.button !== undefined && e.button !== 0) return null;
  if (e.metaKey || e.ctrlKey) return 'tab';
  if (e.shiftKey) return 'window';
  return null;
}

/**
 * 这个元素是不是带 `href` 的真锚点。
 *
 * 用 `tagName` 判定而不是 `instanceof HTMLAnchorElement`：Wujie 沙箱里的构造器
 * 可能来自另一个 realm，`instanceof` 会静默判成 false。
 */
function isAnchorElement(target: unknown): boolean {
  const el = target as { tagName?: unknown; hasAttribute?: (name: string) => boolean } | null;
  return el?.tagName === 'A' && el.hasAttribute?.('href') === true;
}

/** 这次点击是不是「要求浏览器新开一个窗口/标签页」。 */
export function isModifiedClick(e: ModifiedClickLike): boolean {
  return modifiedClickTarget(e) !== null;
}

/** 把站内相对路径解析成绝对地址；已经是绝对地址（含外链）则原样返回。 */
function absoluteHref(href: string): string {
  if (typeof window === 'undefined') return href;
  try {
    return new URL(href, window.location.origin).href;
  } catch {
    return href;
  }
}

/**
 * 把一次「带修饰键的点击」落到新标签页/新窗口上；命中返回 `true`，
 * 调用方直接 return，不要再走 SPA 内跳转。
 *
 * 拿到句柄后手动断开 `opener`，**不**把 `noopener` 写进 features——带该 feature
 * 时 `window.open` 恒返回 `null`，「null = 被拦」的判断就永远为真。
 */
export function openInNewTabIfModified(
  e: ModifiedClickLike & { preventDefault?: () => void },
  href: string
): boolean {
  const target = modifiedClickTarget(e);
  if (!target) return false;

  // 中键落在非链接元素上会触发浏览器的「自动滚动」（Windows/Linux），掐掉它。
  e.preventDefault?.();

  const url = absoluteHref(href);
  const features =
    target === 'window'
      ? `popup,width=${window.outerWidth || 1024},height=${window.outerHeight || 768}`
      : undefined;
  const win = window.open(url, '_blank', features) ?? window.open(url, '_blank');
  if (win) win.opener = null;
  return true;
}

/**
 * 「去某处」的一次点击，分派到正确的通道；返回 `true` 表示调用方不要再跳。
 *
 * - 带修饰键/中键：真锚点什么都不做（浏览器自己会开），普通热区替它开；
 * - 普通左键：只 `preventDefault()`，跳转由调用方完成。
 */
export function handleLinkClick(e: LinkClickEvent, href: string): boolean {
  if (modifiedClickTarget(e)) {
    if (!isAnchorElement(e.currentTarget)) openInNewTabIfModified(e, href);
    return true;
  }
  e.preventDefault?.();
  return false;
}
