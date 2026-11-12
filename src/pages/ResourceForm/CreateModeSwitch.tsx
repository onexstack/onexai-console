import { Segmented } from 'antd';

import styles from './styles.module.scss';

export type CreateMode = 'manual' | 'smart';

export interface CreateModeSwitchProps {
  value: CreateMode;
  onChange: (mode: CreateMode) => void;
  /** 目标业务空间未确定时禁用：没有空间就没有可靠的候选目录。 */
  disabled?: boolean;
}

/**
 * 新建智能体时的两种入口。
 *
 * 只改 `?mode=smart` 查询参数，不重置任何表单/草案状态：手动表单与智能面板都
 * 常驻挂载，用户来回切不会丢输入。
 */
export default function CreateModeSwitch({
  value,
  onChange,
  disabled = false,
}: CreateModeSwitchProps) {
  return (
    <div className={styles.modeBar}>
      <span className={styles.modeLabelText}>创建方式</span>
      <Segmented
        value={value}
        disabled={disabled}
        onChange={next => onChange(next as CreateMode)}
        options={[
          { label: '手动配置', value: 'manual' },
          { label: '智能创建', value: 'smart' },
        ]}
      />
    </div>
  );
}
