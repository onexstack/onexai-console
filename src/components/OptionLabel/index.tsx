import type { ReactNode } from 'react';
import clsx from 'clsx';

import styles from './styles.module.scss';

export interface OptionLabelProps {
  /** 主行：显示名（没有显示名时用资源名）。 */
  title: ReactNode;
  /** 副行：描述。缺省时不占位，候选项保持单行高度。 */
  description?: string;
  /** 紧跟主行的弱化后缀，如「停用」「A2A」。 */
  suffix?: ReactNode;
  className?: string;
}

/**
 * 下拉候选项的「主行 + 描述」两行布局。
 *
 * 抽出组件是为了让智能体选择器在设置抽屉、筛选栏、绑定抽屉、资源表单和快速
 * 跳转里长得一样：主行是显示名，描述另起一行并用更小更浅的字号。两行都折叠
 * 成单行，免得长描述把下拉撑高。
 */
export function OptionLabel({ title, description, suffix, className }: OptionLabelProps) {
  return (
    <div className={clsx(styles.option, className)}>
      <div className={styles.title}>
        <span className={styles.titleText}>{title}</span>
        {suffix ? <span className={styles.suffix}>{suffix}</span> : null}
      </div>
      {description ? <div className={styles.description}>{description}</div> : null}
    </div>
  );
}
