import type { ReactNode } from 'react';
import { Button, Switch, Tooltip } from 'antd';
import {
  CheckCircleFilled,
  ExclamationCircleFilled,
  MinusCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import clsx from 'clsx';

import styles from './styles.module.scss';

/**
 * 账号安全板块的展示原语。
 *
 * 五张卡片、八个条目共用「图标块 + 标题/状态 + 描述 + 右侧操作」这一种行结构，
 * 抽在这里统一规格，避免每张卡片各写一套边距与字号。
 */
export function SecurityCard({
  title,
  className,
  children,
}: {
  title: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={clsx(styles.card, className)}>
      <div className={styles.cardTitle}>{title}</div>
      {children}
    </section>
  );
}

export function SecurityItem({
  icon,
  title,
  status,
  description,
  error,
  action,
}: {
  icon: ReactNode;
  title: ReactNode;
  /** 标题右侧的状态标记，通常是 `StatusChip`。 */
  status?: ReactNode;
  description?: ReactNode;
  /** 行内错误（例如提交确认码失败）。 */
  error?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.securityItem}>
      <div className={styles.securityItemIcon}>{icon}</div>
      <div className={styles.securityItemContent}>
        <div className={styles.securityItemTitleRow}>
          <span className={styles.securityItemTitle}>{title}</span>
          {status}
        </div>
        {description && <div className={styles.securityItemDesc}>{description}</div>}
        {error && <div className={styles.securityItemError}>{error}</div>}
      </div>
      {action && <div className={styles.securityItemAction}>{action}</div>}
    </div>
  );
}

export type StatusTone = 'bound' | 'unbound' | 'pending' | 'muted';

const STATUS_ICONS: Record<StatusTone, ReactNode> = {
  bound: <CheckCircleFilled />,
  unbound: <ExclamationCircleFilled />,
  pending: <SyncOutlined />,
  muted: <MinusCircleOutlined />,
};

const STATUS_CLASSES: Record<StatusTone, string | undefined> = {
  bound: styles.statusBound,
  unbound: styles.statusUnbound,
  pending: styles.statusPending,
  muted: styles.statusMuted,
};

export function StatusChip({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={clsx(styles.statusChip, STATUS_CLASSES[tone])}>
      {STATUS_ICONS[tone]}
      {children}
    </span>
  );
}

/** 后端没有对应接口时，禁用的按钮上统一挂这句提示。 */
const UNWIRED_HINT = '后端暂未提供该接口';

/**
 * 占位操作按钮。
 *
 * antd 的 disabled 元素不派发鼠标事件，Tooltip 必须包一层 `<span>` 才能收到
 * hover；少了这层，用户只会看到一个无法解释的灰按钮。
 */
export function UnwiredButton({ children }: { children: ReactNode }) {
  return (
    <Tooltip title={UNWIRED_HINT}>
      <span className={styles.tooltipAnchor}>
        <Button disabled>{children}</Button>
      </span>
    </Tooltip>
  );
}

export function UnwiredSwitch({ label }: { label: string }) {
  return (
    <Tooltip title={UNWIRED_HINT}>
      <span className={styles.tooltipAnchor}>
        <Switch disabled aria-label={label} />
      </span>
    </Tooltip>
  );
}
