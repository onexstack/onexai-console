import type { ReactNode } from 'react';
import clsx from 'clsx';

import styles from './styles.module.scss';

export interface EllipsisTextProps {
  children: ReactNode;
  /**
   * 单元格内文本的最大宽度（px）。
   *
   * 这是**必需**的内联上限，而不是可选的视觉微调：`table-layout: auto` 下，
   * 列上的 `width` 只是偏好宽度，浏览器仍会按单元格的 max-content 把列撑宽
   * —— 列 `width` + `ellipsis: true` 在那套布局里根本拦不住一条长 URL / 错误
   * 堆栈。给内容本身一个像素上限，列宽才会真的收敛。
   */
  maxWidth?: number;
  /** 悬停提示；缺省取字符串形式的 children。 */
  title?: string;
  className?: string;
}

/**
 * 单行省略文本。
 *
 * 列表页在 auto 布局下截断无界长文本的唯一正确写法：外层的 `max-width` 限定
 * 「这一格最宽多少」，`overflow/text-overflow/nowrap` 负责真正截断，`title`
 * 让用户仍能看到完整值。用于服务地址、调度来源、错误、工单标题这类长度不可控
 * 的字段；短文本列直接交给 auto 布局即可。
 */
export default function EllipsisText({
  children,
  maxWidth = 320,
  title,
  className,
}: EllipsisTextProps) {
  return (
    <span
      className={clsx(styles.text, className)}
      style={{ maxWidth }}
      title={title ?? (typeof children === 'string' ? children : undefined)}
    >
      {children}
    </span>
  );
}
