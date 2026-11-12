/**
 * 复制文本到剪贴板。
 *
 * 为什么不能只写 `navigator.clipboard.writeText`：这个异步 API 只在**安全上下文**
 * 存在（https，或 localhost）。用 http:// 的测试域名访问、或页面被嵌在
 * iframe 里（微前端 / 网关预览）时，`navigator.clipboard` 是 undefined，
 * 或写入被 Permissions Policy 拒绝并 reject——而 `.then()` 没有 `.catch()` 的话
 * 表现就是「点了复制没任何反应」；写成 `navigator.clipboard?.writeText(x)` 更糟：
 * 连错都不抛，调用方接着弹一句「已复制」，于是成了一个**假成功**。
 *
 * 所以这里在异步 API 不可用/被拒时，降级到临时 textarea + `document.execCommand('copy')`，
 * 并把「到底成没成」以布尔值返回，让调用方决定提示成功还是失败，而不是静默吞掉。
 *
 * 放在 `@onex-console/utils` 而不是某个应用里：控制台（含 jsdom 外的阅读页岛）、
 * `@onex-console/ui` 的 `CopyButton`、以及各个子应用都要用同一份实现——
 * 复制入口的表现只该有一个定义（见 `docs/convention/02-组件开发规范.md` 的「复制入口」）。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 继续走下面的兜底：能走到这里通常是文档失焦或权限被策略拒绝。
    }
  }

  return legacyCopy(text);
}

/**
 * 把一段 HTML 当作**富文本**写进剪贴板，同时带一份纯文本。
 *
 * 与 `copyToClipboard` 是两条通道，不是两个入口：文本那条写 `text/plain` 一个 flavor，
 * 而「粘进公众号 / Word / 邮件」要的是 `text/html`——目标应用按 flavor 挑，只给纯文本
 * 时它拿到的是标签串或丢失排版的文字。
 *
 * # 两个 flavor 都要写
 *
 * `text/html` 给认富文本的地方（公众号编辑器），`text/plain` 给不认的地方（终端、
 * 纯文本输入框、部分 IM 输入框）。只写 HTML 时后者粘出来是空的。
 *
 * # 失败要返回 `false`，不能静默
 *
 * 与 `copyToClipboard` 同一条理由：`navigator.clipboard.write` 在非安全上下文、文档
 * 失焦、或浏览器不支持 `ClipboardItem` 时不可用。走 `execCommand` 兜底前先真试一次
 * 异步 API；两条都失败时由调用方说「没成」，而不是弹一句「已复制」。
 *
 * # 兜底为什么是「选中一个节点」而不是 textarea
 *
 * textarea 只能承载纯文本。富文本的 `execCommand('copy')` 复制的是**选区里的 DOM**，
 * 浏览器会自己同时写 `text/html` 与 `text/plain` 两个 flavor——所以兜底要把内容渲染成
 * 真实节点、选中它，再 `copy`。节点必须留在文档流里（`display:none` 的节点选不中，
 * 复制结果是空串），所以用 `fixed` + 1px + 透明把它移出视觉。
 */
export async function copyRichText(html: string, text: string): Promise<boolean> {
  if (!html) return false;

  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return true;
    } catch {
      // 继续走下面的兜底：不支持多 flavor、文档失焦、或权限被策略拒绝。
    }
  }

  return legacyCopyRich(html);
}

/** 富文本兜底：把 HTML 挂成真实节点、选中、`execCommand('copy')`。 */
function legacyCopyRich(html: string): boolean {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  holder.setAttribute('aria-hidden', 'true');
  // 与 `legacyCopy` 同一条：不能 `display:none` / `visibility:hidden`——那样的节点选不中。
  holder.style.position = 'fixed';
  holder.style.top = '0';
  holder.style.left = '0';
  holder.style.width = '1px';
  holder.style.height = '1px';
  holder.style.overflow = 'hidden';
  holder.style.opacity = '0';
  holder.style.pointerEvents = 'none';

  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  document.body.appendChild(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection?.removeAllRanges();
  selection?.addRange(range);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }

  document.body.removeChild(holder);

  // 还原用户原本的选区，避免这次复制把他在页面别处的选择清掉。
  if (selection) {
    selection.removeAllRanges();
    if (previousRange) selection.addRange(previousRange);
  }

  return ok;
}

/** `document.execCommand('copy')` 兜底：建一个不可见的 textarea 选中后复制。 */
function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  // 不能 display:none / visibility:hidden——那样的节点选不中，复制到的是空串。
  // 放到视口内、再靠透明与移出可视区隐藏。
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.outline = 'none';
  textarea.style.boxShadow = 'none';
  textarea.style.background = 'transparent';
  textarea.style.opacity = '0';

  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }

  document.body.removeChild(textarea);

  // 还原用户原本的选区，避免这次复制把他在页面别处的选择清掉。
  if (selection) {
    selection.removeAllRanges();
    if (previousRange) selection.addRange(previousRange);
  }

  return ok;
}
