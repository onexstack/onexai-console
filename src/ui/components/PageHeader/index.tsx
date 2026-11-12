import type { ReactNode } from 'react';
import { Button } from 'antd';
import { LeftOutlined } from '@ant-design/icons';
import clsx from 'clsx';

import styles from './styles.module.scss';

/**
 * 控制台页头的唯一规格来源：返回箭头 + 20px 标题 + 可选副标题 / 操作行。
 *
 * 从火山引擎控制台（`~/22.png`）对齐：
 * - 细箭头 chevron（`LeftOutlined`），32×32 点击区，图标左缘与内容左缘对齐；
 * - 标题 20px / 600 / 28px 行高；
 * - 页头上下各 16px，**自己不画分隔线**；白色通栏背景与底部阴影由外壳的
 *   `.headerBar`（`page-header-bar` mixin）负责。
 *
 * # 谁负责水平内边距
 *
 * 默认 `inset` 为真：页头自己留出 `--page-gutter`。`PageLayout` 与路由态
 * `DetailShell` 的页头都包在各自的白色 `.headerBar` 里，由这里负责 gutter，
 * 标题左缘因此与内容卡片左缘对齐；`PageSurface` 里的 `CommandConsole` 等也用它。
 * 外壳已经给正文留了同样的 gutter 时才传 `inset={false}`（如 `ResourceShell`、
 * `DetailShell` 的 `embedded` 模式）。
 *
 * # 留在调用方的
 *
 * 返回动作（各自的 `useGoBack`）、操作按钮的语义（发布/删除/编辑…）、标题内容。
 * 这里只统一「长什么样」与「排在哪一行」。
 */
export interface PageHeaderProps {
  /** 页面标题。不传则不渲染标题（例如只有返回箭头的空壳页）。 */
  title?: ReactNode;
  /** 标题下方的说明文字。 */
  subtitle?: ReactNode;
  /**
   * 标题行右侧的附加内容（页面级筛选、作用域选择器等）。
   *
   * 与标题同一行、靠右对齐：把它放在标题下方会跟副标题抢同一块语义空间，
   * 读起来像「标题的一部分」。窄屏下自动换到标题行的下一行。
   */
  titleExtra?: ReactNode;
  /** 返回动作。**传了才渲染返回按钮**。 */
  onBack?: () => void;
  /** 返回按钮的无障碍标签，默认「返回」。 */
  backAriaLabel?: string;
  /**
   * 标题行下方的操作区。
   *
   * 详情页已改为把操作放进外壳在「标题卡与内容卡之间」的工具条
   * （`DetailShell` 的 route 模式），这里目前只由 `embedded` 模式使用。
   */
  actions?: ReactNode;
  /**
   * 标题标签。默认 `h1`；`DetailShell` 传 `span`（资源 ID 不是文档标题），
   * 需要沿用旧 DOM 的页面也可以指定。
   */
  titleAs?: 'h1' | 'h2' | 'span';
  /** 是否由页头自己提供左右 gutter。外壳已有 gutter 时传 `false`。 */
  inset?: boolean;
  className?: string;
  headerTestId?: string;
  backTestId?: string;
  titleTestId?: string;
  actionsTestId?: string;
}

export default function PageHeader({
  title,
  subtitle,
  titleExtra,
  onBack,
  backAriaLabel = '返回',
  actions,
  titleAs: TitleTag = 'h1',
  inset = true,
  className,
  headerTestId,
  backTestId,
  titleTestId,
  actionsTestId,
}: PageHeaderProps) {
  const showTitleRow = Boolean(onBack) || title != null || titleExtra != null;

  return (
    <header
      className={clsx(styles.header, !inset && styles.noInset, className)}
      data-testid={headerTestId}
    >
      {showTitleRow && (
        <div className={styles.titleRow}>
          {onBack && (
            <Button
              type="text"
              className={styles.back}
              icon={<LeftOutlined />}
              onClick={onBack}
              aria-label={backAriaLabel}
              data-testid={backTestId}
            />
          )}
          {title != null && (
            <TitleTag className={styles.title} data-testid={titleTestId}>
              {title}
            </TitleTag>
          )}
          {titleExtra != null && <div className={styles.titleExtra}>{titleExtra}</div>}
        </div>
      )}
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      {actions && (
        <div className={styles.actions} data-testid={actionsTestId}>
          {actions}
        </div>
      )}
    </header>
  );
}
