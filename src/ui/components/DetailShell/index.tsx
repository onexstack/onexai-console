import type { ReactNode } from 'react';
import { Space, Spin, Tabs } from 'antd';
import type { TabsProps } from 'antd';
import clsx from 'clsx';

import PageHeader from '../PageHeader';
import styles from './styles.module.scss';

/**
 * 详情页外壳：白色页头通栏（返回 · 资源 ID）+ 操作工具条 + 白色内容卡片（Tabs / 正文）。
 *
 * # 为什么要有这个组件
 *
 * 这套外壳此前在仓库里存在五份复制（miniblog 的文章 / 点赞 / 任务 / 定时任务四个
 * 详情页各一份，宿主商品详情页一份），而且**复制出来就已经不一致**：文章页的 ID 是
 * 16px/600，其余三页是 14px/500；宿主那份干脆换成了 `PageCard`（圆角 + 阴影 +
 * 卡片头右侧带文字的返回按钮）。外壳没有单一真源时，「对齐」只能靠人肉逐处比，
 * 下一轮重构又会漂走。
 *
 * 所以规格只留在这里，调用方一律不再写：灰色页面底、白色页头通栏（细箭头 +
 * 20px/600 标题，轻阴影）、标题卡与内容卡之间的操作工具条（按钮不放进标题卡，
 * 参考腾讯云列表页）、白色内容卡片（圆角 + 描边）、Tabs `marginTop: 0`；
 * 只有正文卡片区滚动，页头与工具条固定。
 *
 * # 留在调用方的
 *
 * 操作按钮本身（发布/归档/删除、上架/下架/删除、创建…语义各不相同）、`tabs.items`
 * 的面板内容（含空态）、Tabs 是否受控、有没有 ID 与返回值。强行上收这些只会造出
 * 一个「什么都得传、传了还得判断」的错误抽象。
 *
 * # 已知差异（不是 bug）
 *
 * 卡片**外**的偏移两边差 8px：宿主 `MainLayout.content` 的 padding 是 24，miniblog
 * `DefaultLayout.content` 是 16。列表页那一侧已把「内容区内缩 40px」定为规格（有
 * e2e 断言），所以这里只对齐卡片自身，不去改那两种布局。高度机制也不同：miniblog
 * 靠父级 flex 列的 `flex: 1`，宿主靠 `PageTransition` 的 `height: 100%`——两种都给上，
 * 哪种生效都不会变形。
 */
export interface DetailShellProps {
  /** 资源 ID，渲染在页头（仅 `showId` 为真时）。 */
  id?: ReactNode;
  /** 返回回调。**传了才渲染返回图标**：列表页签视图复用同一组件时不传。 */
  onBack?: () => void;
  /** 是否展示资源 ID；页签视图传 `false`（外层页签标题已经写了 ID）。默认 `true`。 */
  showId?: boolean;
  /**
   * 页面操作按钮，如 `<Button type="primary">发布</Button>`。
   *
   * route 模式下渲染在 `标题卡与内容卡之间` 的工具条里；`embedded` 模式没有
   * 独立卡片分层，仍渲染在页头。
   */
  actions?: ReactNode;
  /** Tabs 的 items；不传则渲染 `children`。 */
  tabs?: TabsProps['items'];
  /** Tabs 受控 key（宿主用 `?section=` 深链时需要）。 */
  activeKey?: string;
  /** Tabs 切换回调，参数即 antd Tabs 的 key。 */
  onTabChange?: (key: string) => void;
  /** 无 Tabs 时的正文（如新建页的表单）。 */
  children?: ReactNode;
  /**
   * `route`（默认）：灰色页面底 + 白色页头通栏 + 操作工具条 + 白色内容卡片；
   * `loading` 时页头与工具条保持可见，卡片内渲染居中大号 Spin。
   * `embedded`：不套容器——嵌在 `ResourcePage` 页签视图的卡片里，外面已经有
   * 滚动区与内边距，再套一层会变成「卡片里再套一张白卡」且两层 padding 叠加。
   */
  variant?: 'route' | 'embedded';
  /** 仅 `route` 生效：数据加载中。 */
  loading?: boolean;
  className?: string;
}

export default function DetailShell({
  id,
  onBack,
  showId = true,
  actions,
  tabs,
  activeKey,
  onTabChange,
  children,
  variant = 'route',
  loading = false,
  className,
}: DetailShellProps) {
  // 页头在两种 variant 下是**同一份 JSX**：详情页不该有「路由模式一张脸、
  // 页签模式另一张脸」，那正是漂移的起点。唯一的差异是操作按钮：route 模式
  // 把它放进标题卡与内容卡之间的工具条（按钮不占标题卡片），embedded 模式
  // 外面没有卡片分层，仍留在页头里。
  const header = (
    <PageHeader
      title={showId ? id : undefined}
      titleAs="span"
      onBack={onBack}
      inset={variant !== 'embedded'}
      actions={variant === 'embedded' && actions ? <Space>{actions}</Space> : undefined}
      headerTestId="detail-shell-header"
      backTestId="detail-shell-back"
      titleTestId="detail-shell-id"
      actionsTestId="detail-shell-actions"
    />
  );

  // `tabs` 与 `children` 二选一，而不是「都传再判断」：新建页没有 Tabs、详情页
  // 没有表单，含糊的 props 会让下一次改动猜不到该往哪塞。
  const body = tabs ? (
    <Tabs items={tabs} activeKey={activeKey} onChange={onTabChange} style={{ marginTop: 0 }} />
  ) : (
    children
  );

  if (variant === 'embedded') {
    return (
      <div className={className}>
        {header}
        {body}
      </div>
    );
  }

  return (
    <div
      className={clsx(styles.shell, className)}
      data-testid="detail-shell"
      data-page-surface="flush"
    >
      <div className={styles.headerBar}>{header}</div>
      {actions && (
        <div className={styles.toolbar} data-testid="detail-shell-actions">
          {actions}
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.panel}>
          {loading ? (
            <div className={styles.loading} data-testid="detail-shell-loading">
              <Spin size="large" />
            </div>
          ) : (
            body
          )}
        </div>
      </div>
    </div>
  );
}
