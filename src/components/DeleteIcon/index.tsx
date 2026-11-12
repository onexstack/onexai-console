import type { SVGProps } from 'react';

/**
 * 删除图标：火山引擎控制台同款线框垃圾桶。
 *
 * 尺寸用 `1em`，跟随按钮/文字的字号；颜色用 `currentColor`，danger 按钮自动
 * 变红。所有图标式删除入口共用这一个字形，避免各页面画法不一致。
 */
export default function DeleteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l.7 12.1A1.5 1.5 0 0 0 8.7 20.5h6.6a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
      <path d="M10 11v5.5M14 11v5.5" />
    </svg>
  );
}
