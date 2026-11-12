import { Button, Empty } from 'antd';
import { SettingOutlined } from '@ant-design/icons';

import styles from './styles.module.scss';

export function EmptyState({
  hasAgent,
  onOpenSettings,
}: {
  hasAgent: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <div className={styles.centerBox}>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={hasAgent ? '输入消息开始对话' : '先在设置中选择一个智能体'}
      >
        {!hasAgent && (
          <Button size="small" icon={<SettingOutlined />} onClick={onOpenSettings}>
            打开设置
          </Button>
        )}
      </Empty>
    </div>
  );
}
