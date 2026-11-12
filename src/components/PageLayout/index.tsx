import type { ReactNode } from 'react';
import { Spin } from 'antd';
import clsx from 'clsx';

import PageHeader from '@/ui/components/PageHeader';

import styles from './styles.module.scss';

/**
 * 控制台内的「整页」外壳：页头卡片、内容卡片、底部操作栏。
 *
 * 版式对齐腾讯云 TKE 创建页（`~/11.png`）：灰色页面底 + 白色页头通栏（带轻阴影）
 * + 白色内容卡片 + 吸底操作栏。新建/编辑向导、重置密码、A2A 注册、工单详情都用
 * 这一份，避免各页各写一套页头、卡片与底部按钮。
 *
 * # 滚动
 *
 * `DefaultLayout` 的内容区是 `overflow: hidden` 的 flex 列，所以滚动容器放在
 * 这里（`.body`），页头与底部操作栏留在滚动区之外 —— 表单一长，页头与按钮仍然可见。
 */
export interface PageLayoutProps {
  title: ReactNode;
  /** 标题行右侧的附加内容（如业务空间选择器），与标题同一行靠右。 */
  titleExtra?: ReactNode;
  /** 返回动作。不传则不渲染返回箭头（例如嵌入到其他页面时）。 */
  onBack?: () => void;
  /** 底部操作栏左侧按钮。不传且没有 `footerExtra` 时不渲染整条操作栏。 */
  footer?: ReactNode;
  /** 底部操作栏右侧的补充信息（如「第 1 / 2 步」）。 */
  footerExtra?: ReactNode;
  /**
   * 底部按钮排布。`start`（默认）保留旧页面「按钮靠左」的版式；
   * `end` 对齐火山引擎表单页的「取消 / 创建」右对齐底栏。
   */
  footerAlign?: 'start' | 'end';
  /** 面板内容加载中：用居中 Spin 代替 children。 */
  loading?: boolean;
  children?: ReactNode;
}

export default function PageLayout({
  title,
  titleExtra,
  onBack,
  footer,
  footerExtra,
  footerAlign = 'start',
  loading = false,
  children,
}: PageLayoutProps) {
  const showFooter = Boolean(footer || footerExtra);

  return (
    <div className={styles.page} data-page-surface="flush">
      <div className={styles.headerBar}>
        <PageHeader title={title} titleExtra={titleExtra} onBack={onBack} />
      </div>

      <div className={styles.body}>
        <div className={styles.panel}>
          {loading ? (
            <div className={styles.loading}>
              <Spin size="large" />
            </div>
          ) : (
            children
          )}
        </div>
      </div>

      {showFooter && (
        <footer className={clsx(styles.footer, footerAlign === 'end' && styles.footerEnd)}>
          <div className={styles.footerActions}>{footer}</div>
          {footerExtra && <span className={styles.footerMeta}>{footerExtra}</span>}
        </footer>
      )}
    </div>
  );
}
