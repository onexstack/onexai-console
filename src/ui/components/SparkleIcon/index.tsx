import { memo } from 'react';

/**
 * OneX 的四角星标识。
 *
 * 聊天页用作助手头像（深紫实心底上的白色星），智能创建分析中用作状态图标。
 * 颜色默认是白色，调用方按底色传入。
 */
export const SparkleIcon = memo(function SparkleIcon({
  size = 13,
  color = '#fff',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <g transform="rotate(45 10 10)">
        <path
          d="M10 0.5L11.6 8.4L19.5 10L11.6 11.6L10 19.5L8.4 11.6L0.5 10L8.4 8.4Z"
          fill={color}
        />
        <path
          d="M15.5 2.5L16.1 4.9L18.5 5.5L16.1 6.1L15.5 8.5L14.9 6.1L12.5 5.5L14.9 4.9Z"
          fill={color}
        />
      </g>
    </svg>
  );
});
