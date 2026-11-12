import { App, Button, message as staticMessage, type ButtonProps } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useCallback, type FC, type ReactNode } from 'react';
import { copyToClipboard } from '@/lib/clipboard';

/** `App.useApp()` 交出来的 message 实例类型（与 `apps/main/src/api/appMessage.ts` 同形）。 */
type AppMessage = ReturnType<typeof App.useApp>['message'];

export interface CopyButtonProps {
  /** 要复制的内容。空值（`''` / `null` / `undefined`）不渲染按钮——一个能复制出空串的
   *  按钮只会让人以为「这里有个值，只是显示不出来」。带 `children` 的按钮例外
   *  （见下），那种情况由调用方自己决定禁用。 */
  value?: string | null;
  /** 按钮文字。**只有页面主操作按钮才传**（工具站的「复制结果」）；行内复制入口一律不带
   *  文字，只有图标——同一个动作在表格、卡片、气泡里长出三种形状，用户得每次重新认。 */
  children?: ReactNode;
  /** 自定义类名 */
  className?: string;
  /** 按钮尺寸，默认 `small` */
  size?: ButtonProps['size'];
  /** 按钮类型，默认 `text`（行内 / 表格里不抢视线） */
  type?: ButtonProps['type'];
  /** 是否禁用 */
  disabled?: boolean;
  /** 图标，默认 `CopyOutlined`。分享面板那类「这个图标本身就在说是什么」的地方才需要换
   *  （拷贝链接用 `LinkOutlined`），换的只是字形，行为与提示仍是这一套。 */
  icon?: ReactNode;
  /** 无障碍名。**不可见**，但它同时是 e2e 的选择器，改文案前先看 `e2e/cases/*`。 */
  ariaLabel?: string;
  /** 成功提示文案，默认「已复制」 */
  successText?: string;
  /** 失败提示文案，默认「复制失败，请手动复制」 */
  failureText?: string;
  /** 复制成功后的回调（分享面板要上报计数才用） */
  onCopied?: () => void;
}

/**
 * 取当前可用的 message。
 *
 * 组件树里有 `<AntApp>` 就用它的实例（跟随主题与 ConfigProvider）；没有就退回静态方法。
 * 子应用（miniblog / app-center / agent / tools）的 `App.tsx` 里没有 `<AntApp>`，此时
 * `App.useApp()` 返回的是 antd 的 context 默认值 `{ message: {}, ... }`——直接调
 * `app.message.success` 会抛「success is not a function」，所以要先判一下是不是真实例。
 */
const useNotifier = (): AppMessage => {
  const { message } = App.useApp();
  return typeof message?.success === 'function' ? message : staticMessage;
};

/**
 * 全站唯一的复制控件——**纯图标**、**无 children**、**不挂 Tooltip**。
 *
 * # 为什么是唯一的
 *
 * 复制这件事有两个容易出错的地方，各写一遍就各错一遍：
 *
 * 1. **写不进剪贴板时照样提示成功。** `navigator.clipboard` 只在安全上下文存在
 *    （https / localhost）。用 http 域名访问时它是 undefined，于是
 *    `navigator.clipboard?.writeText(x)` 什么都没做、下一行却弹「已复制」。走
 *    `@onex-console/utils` 的 `copyToClipboard`（带 execCommand 兜底且返回布尔值），
 *    成功与失败才说得出真话。
 * 2. **形态各不一样。** 有的按钮带「复制」二字、有的裸图标、有的挂 Tooltip 写
 *    「复制登录名」。同一个动作在这个界面里长出三种样子，用户得每次重新认一遍。
 *
 * 所以这里定死一套：图标 + `aria-label`（无障碍与 e2e 用，不显示），点击成功「已复制」、
 * 失败「复制失败，请手动复制」。要 i18n 的应用把这几个文案当 props 传进来
 * （控制台就是这么做的，见 `apps/main/src/components/CopyButton`）。
 */
export const CopyButton: FC<CopyButtonProps> = ({
  value,
  children,
  className,
  size = 'small',
  type = 'text',
  disabled,
  icon = <CopyOutlined />,
  ariaLabel = '复制',
  successText = '已复制',
  failureText = '复制失败，请手动复制',
  onCopied,
}) => {
  const notify = useNotifier();
  const text = value == null ? '' : String(value);

  const handleClick = useCallback(() => {
    void (async () => {
      const ok = await copyToClipboard(text);
      if (!ok) {
        notify.error(failureText);
        return;
      }
      notify.success(successText);
      onCopied?.();
    })();
  }, [text, notify, successText, failureText, onCopied]);

  // 空值不画按钮：一个能复制出空串的按钮只会让人以为「这里有个值，只是显示不出来」。
  // 带文字的按钮例外 —— 它是页面上一个固定动作，「还没算出结果」时该显示成禁用而不是
  // 消失（消失会让那一排的布局跟着动，工具站的两个「复制结果」就是这种）。
  if (!text && !children) return null;

  return (
    <Button
      type={type}
      size={size}
      className={className}
      disabled={disabled}
      icon={icon}
      // 有文字时由文字当无障碍名（写成「复制」会把「复制结果」这个更具体的说法盖掉）。
      aria-label={children ? undefined : ariaLabel}
      onClick={handleClick}
    >
      {children}
    </Button>
  );
};

export default CopyButton;
