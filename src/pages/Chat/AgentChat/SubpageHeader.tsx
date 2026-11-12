import type { ReactNode } from 'react';
import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

import styles from './styles.module.scss';

/** 历史/设置子页面的头：标题 + 关闭（返回聊天）。 */
export function SubpageHeader({
  title,
  extra,
  closeLabel = '返回聊天',
  onClose,
}: {
  title: string;
  extra?: ReactNode;
  /** 关闭按钮的可访问名称；停靠在右侧时用「收起」。 */
  closeLabel?: string;
  onClose: () => void;
}) {
  return (
    <div className={styles.inPanelHeader}>
      <div className={styles.inPanelTitle}>{title}</div>
      <div className={styles.inPanelActions}>
        {extra}
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
        />
      </div>
    </div>
  );
}
