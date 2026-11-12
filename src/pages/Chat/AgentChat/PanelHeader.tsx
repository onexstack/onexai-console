import type { ReactNode } from 'react';
import { Button } from 'antd';
import { CloseOutlined, FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';

import { PANEL_TITLE } from './chatUtils';
import styles from './styles.module.scss';

/**
 * 面板/页面级页头。
 *
 * 聊天页用它显示「OneX 智能体 + agent」；调试台用它作为唯一的一级页头
 * （title="调试台"），因此 extra 必须支持页面自己的操作按钮。
 */
export function PanelHeader({
  title = PANEL_TITLE,
  agentLabel,
  extra,
  closeLabel = '关闭',
  closeIcon,
  fullscreen,
  onToggleFullscreen,
  onClose,
}: {
  title?: string;
  agentLabel?: string;
  extra?: ReactNode;
  closeLabel?: string;
  closeIcon?: ReactNode;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.header}>
      <div className={styles.headerTitle}>
        <span>{title}</span>
        {agentLabel && (
          <span className={styles.headerAgent} title={agentLabel}>
            {agentLabel}
          </span>
        )}
      </div>

      <div className={styles.headerActions}>
        {extra}
        <Button
          type="text"
          className={`${styles.headerBtn} ${styles.headerFullscreen}`}
          icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? '退出全屏' : '全屏'}
          title={fullscreen ? '退出全屏' : '全屏'}
        />
        <Button
          type="text"
          className={styles.headerBtn}
          icon={closeIcon ?? <CloseOutlined />}
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
        />
      </div>
    </div>
  );
}
