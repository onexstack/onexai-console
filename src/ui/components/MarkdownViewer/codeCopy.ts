import { message } from 'antd';
import type { BytemdPlugin, BytemdViewerContext } from 'bytemd';

import { copyToClipboard } from '@/lib/clipboard';

/**
 * 代码块的一键复制。
 *
 * # 为什么是「渲染后改 DOM」而不是 rehype 插件
 *
 * bytemd 的 Viewer 把渲染结果整段交给 `innerHTML`。做成 rehype 插件只能在 bytemd
 * 这一条管线里生效；而「渲染后给 `pre` 套一层定位容器」的写法与具体渲染器无关，
 * 将来若换库也不用重写按钮。
 *
 * # 为什么套一层 `.markdown-code-block`
 *
 * `pre` 自己带 `overflow-x: auto`。按钮若放在 `pre` 里面，代码一横向滚动，按钮会
 * 跟着内容滚出视野。套一层定位容器，让按钮浮在滚动区域之外。
 *
 * # 为什么用事件委托
 *
 * 流式回答每来一段增量就会整段重解析、`innerHTML` 整体换掉，按钮节点也跟着换。
 * 委托在容器上只挂一个监听，换掉多少节点都不用管，也不会叠加。
 */

const CODE_BLOCK_CLASS = 'markdown-code-block';
const CODE_COPY_CLASS = 'markdown-code-copy';

const COPY_ICON =
  '<svg viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor" focusable="false" aria-hidden="true"><path d="M832 64H296c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8h496v688c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8V96c0-17.7-14.3-32-32-32zM704 192H192c-17.7 0-32 14.3-32 32v530.7c0 8.5 3.4 16.6 9.4 22.6l173.3 173.3c2.2 2.2 4.7 4 7.4 5.5v1.9h4.2c3.5 1.3 7.2 2 11 2H704c17.7 0 32-14.3 32-32V224c0-17.7-14.3-32-32-32zM350 856.2L263.9 770H350v86.2zM664 888H414V746c0-22.1-17.9-40-40-40H232V264h432v624z"></path></svg>';

const CHECK_ICON =
  '<svg viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor" focusable="false" aria-hidden="true"><path d="M912 190h-69.9c-9.8 0-19.1 4.5-25.1 12.2L404.7 724.5 207 474a32 32 0 00-25.1-12.2H112c-6.7 0-10.4 7.7-6.3 12.9l273.9 347c12.8 16.2 37.4 16.2 50.3 0l488.4-618.9c4.1-5.1.4-12.8-6.3-12.8z"></path></svg>';

const COPIED_RESET_MS = 1600;

/**
 * 给 `root` 里的每个代码块补上复制按钮，返回解绑函数。
 *
 * - 只处理 `pre > code`，行内 `<code>` 不动。
 * - 幂等：已经包过的 `pre` 不再包第二层（流式重解析会反复调用）。
 */
export function enhanceCodeCopy(root: HTMLElement): () => void {
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    const parent = pre.parentElement;
    if (!parent) continue;
    if (parent.classList.contains(CODE_BLOCK_CLASS)) continue;

    const code = Array.from(pre.children).find(element => element.tagName === 'CODE');
    if (!code) continue;
    if (code.classList.contains('language-mermaid')) continue;

    const wrapper = document.createElement('div');
    wrapper.className = CODE_BLOCK_CLASS;
    parent.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    wrapper.appendChild(createCopyButton());
  }

  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest(`button.${CODE_COPY_CLASS}`);
    if (!(button instanceof HTMLButtonElement) || !root.contains(button)) return;

    const code = button.parentElement?.querySelector('pre > code');
    if (!code) return;

    // 点击时才读原文：高亮插件会把代码内容重新包成 span，但 textContent 始终是原文。
    void copyCode(button, code.textContent ?? '');
  };

  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

/** `viewerEffect` 在每次渲染之后触发，bytemd 会先调上一次的清理函数。 */
export const CODE_COPY_PLUGIN: BytemdPlugin = {
  viewerEffect({ markdownBody }: BytemdViewerContext) {
    return enhanceCodeCopy(markdownBody);
  },
};

function createCopyButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = CODE_COPY_CLASS;
  button.setAttribute('aria-label', '复制代码');
  button.innerHTML = COPY_ICON;
  return button;
}

const resetTimers = new WeakMap<HTMLButtonElement, number>();

async function copyCode(button: HTMLButtonElement, text: string): Promise<void> {
  const ok = await copyToClipboard(text);
  if (!ok) {
    message.error('复制失败，请手动复制');
    return;
  }

  button.innerHTML = CHECK_ICON;
  button.setAttribute('aria-label', '已复制');

  const previous = resetTimers.get(button);
  if (previous !== undefined) window.clearTimeout(previous);

  resetTimers.set(
    button,
    window.setTimeout(() => {
      resetTimers.delete(button);
      if (!button.isConnected) return;
      button.innerHTML = COPY_ICON;
      button.setAttribute('aria-label', '复制代码');
    }, COPIED_RESET_MS)
  );
}
