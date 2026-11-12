import type { ReactNode } from 'react';
import clsx from 'clsx';

import PageHeader from '../PageHeader';
import styles from './styles.module.scss';

/**
 * 控制台页面外壳：页面底色 + 可选标题/副标题/工具栏 + 内容。
 *
 * # 为什么要有这个组件
 *
 * 这套外壳原先只存在于 `ResourcePage` 内部（`.container` / `.pageTitle` / `.card`），
 * 而宿主 `/admin/*` 的其余几页（知识库、知识库导入、11 个运营对象）各自用 `PageCard`
 * 另起了一套：**无描边 + 有阴影 + 16px 标题**，与这边（1px 描边 + 无阴影 + 18px 标题）
 * 正好相反。同一个控制台里于是有两种「页面」，且没有单一真源可对照。
 *
 * 现在整页是白底、无灰带：标题走共享的 `PageHeader`（20px/600），表格卡直接铺在
 * 白底上，水平内缩只由 `.container` 的 `--page-gutter` 提供。
 *
 * `PageCard` 不能顺手改默认值 —— 它被 6 个应用、三十多个文件共用，改默认等于把
 * 后台的对齐问题放大成全站视觉回归。所以把外壳抽到这里，两边消费同一份声明。
 *
 * # 留在调用方的
 *
 * 工具栏里放什么按钮、表格是 `ResourcePage` 那套还是自己写的、要不要分页 —— 各页
 * 差别太大，强行上收只会造出一个「什么都得传」的错误抽象。
 *
 * # 渲染顺序是契约
 *
 * `ResourceShell` 渲染的一定是 `容器 → [标题] → [副标题] → [工具栏] → children`，
 * **不额外包一层**：`ResourcePage` 的 DOM 必须与抽取前逐字节相同，否则 e2e 里
 * 「从卡片往上找第一层不透明背景」会找到新插入的包裹层，页面底色断言直接变红。
 * （`titleExtra` 是例外：它渲染在标题行**内部**的右侧，不新增行。）
 */
export interface ResourceShellProps {
  /** 页面标题。**不传则不渲染 `<h2>`** —— 列表页可以没有标题。 */
  title?: ReactNode;
  /** 标题下的次级说明。 */
  subtitle?: ReactNode;
  /** 标题行右侧的附加内容（页面级筛选、作用域选择器等）。 */
  titleExtra?: ReactNode;
  /** 标题下方的操作区（按钮、筛选等）。 */
  toolbar?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function ResourceShell({
  title,
  subtitle,
  titleExtra,
  toolbar,
  children,
  className,
}: ResourceShellProps) {
  return (
    <div className={clsx(styles.container, className)} data-page-surface="flush">
      {(title != null || subtitle != null || titleExtra != null) && (
        <PageHeader title={title} subtitle={subtitle} titleExtra={titleExtra} inset={false} />
      )}
      {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
      {children}
    </div>
  );
}

/**
 * 表格卡：白底、圆角 8、1px 描边、无阴影，并把表内字号/内边距/表头底色压到控制台规格。
 *
 * `loose` 是行高密度档（单元格 10px vs 5px）。它与 `.card` 的规则特异性相同、只靠
 * 源码顺序定胜负，所以两者必须待在同一个样式文件里 —— 见 `styles.module.scss` 的注释。
 */
export function ResourceCard({
  children,
  loose,
  className,
}: {
  children: ReactNode;
  loose?: boolean;
  className?: string;
}) {
  return <div className={clsx(styles.card, loose && styles.cardLoose, className)}>{children}</div>;
}

export default ResourceShell;
