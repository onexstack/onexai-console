import type { ReactNode } from 'react';

import { ValueWithActions } from '../DetailPage';
import styles from './styles.module.scss';

export interface ResourceNameCellProps {
  /** 主键原始值（复制用）。 */
  id: string;
  /** 已经包好链接/点击行为的主键节点。 */
  idNode: ReactNode;
  /**
   * 第二行名称；`undefined` 表示这个资源没有名称字段，只渲染 ID 行。
   * 空串仍然渲染，因为列表是补上缺失名称的唯一入口。
   */
  name?: string;
  /** 是否展示主键复制按钮（`ResourceDescriptor.idCopyable`）。 */
  copyId?: boolean;
  /** 名称改名；不传则没有铅笔入口。 */
  onRename?: (next: string) => Promise<void>;
  /** 文案翻译；缺省原样返回，便于独立使用。 */
  t?: (key: string) => string;
}

/**
 * 列表里的「ID/名称」单元格。
 *
 * 两行结构：第一行主键（链接 + 复制），第二行显示名（复制 + 悬停改名）。
 * `ResourcePage` 与自定义的 Agents 列表共用它，避免两处各写一套悬停交互后
 * 手感分叉（见 `ValueWithActions` 的 `hoverReveal`）。
 */
export function ResourceNameCell({
  id,
  idNode,
  name,
  copyId = true,
  onRename,
  t = key => key,
}: ResourceNameCellProps) {
  return (
    <div className={styles.idCell}>
      <span className={styles.idLine}>
        <ValueWithActions
          value={idNode}
          rawValue={id}
          copyable={copyId}
          copyAriaLabel={t('复制 ID')}
          revealActionsOnHover
        />
      </span>
      {name !== undefined && (
        <span className={styles.idName}>
          <ValueWithActions
            value={
              <span className={styles.idSubText} title={name || undefined}>
                {name || '-'}
              </span>
            }
            rawValue={name}
            copyable={Boolean(name)}
            copyAriaLabel={t('复制名称')}
            // 悬停名称才现铅笔：一列常亮的铅笔会让整张列表读起来像表单。
            revealActionsOnHover
            editable={
              onRename
                ? {
                    currentValue: name,
                    // 与表单里的显示名保持一致；改这两处时要一起改。
                    maxLength: 64,
                    validate: value => (value.trim() ? undefined : t('名称不能为空')),
                    onSave: onRename,
                  }
                : undefined
            }
          />
        </span>
      )}
    </div>
  );
}

export default ResourceNameCell;
