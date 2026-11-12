import { useEffect, useState } from 'react';
import { HolderOutlined } from '@ant-design/icons';
import { Modal, Radio, Switch } from 'antd';

import styles from './styles.module.scss';
import type { ColItem, ColumnLayout, ColumnSettingsModalProps } from './types';

/**
 * 列表页共用的「设置列表字段」对话框。
 *
 * 所有列表页（`ResourcePage` 驱动的 20 多个资源页、自绘工具栏的智能体列表…）都必须
 * 用同一个对话框：字段顺序、显隐、行密度这三件事在各页面之间没有任何业务差异，
 * 各写一份只会让「设置」在不同页面里长得不一样。
 */

export default function ColumnSettingsModal({
  open,
  layout: initLayout,
  items: initItems,
  onOk,
  onCancel,
}: ColumnSettingsModalProps) {
  const [layout, setLayout] = useState(initLayout);
  const [items, setItems] = useState(initItems);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setLayout(initLayout);
      setItems(initItems);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // First item is fixed (ID/名称), rest are draggable
  const fixed = items[0] as ColItem | undefined;
  const draggable = items.slice(1);

  const reorder = (from: number, to: number) => {
    if (from === to || !fixed) return;
    const arr = [...draggable];
    const [moved] = arr.splice(from, 1);
    if (!moved) return;
    arr.splice(to, 0, moved);
    setItems([fixed, ...arr]);
  };

  const toggleVisible = (idx: number, checked: boolean) => {
    const arr = items.map((it, i) => (i === idx + 1 ? { ...it, visible: checked } : it));
    setItems(arr);
  };

  return (
    <Modal
      title="设置列表字段"
      open={open}
      onOk={() => onOk(layout, items)}
      onCancel={onCancel}
      okText="确定"
      cancelText="取消"
      width={480}
      destroyOnHidden
    >
      <div className={styles.colSettingsSection}>
        <div className={styles.colSettingsSectionTitle}>布局设置</div>
        <Radio.Group value={layout} onChange={e => setLayout(e.target.value as ColumnLayout)}>
          <Radio value="compact">紧凑</Radio>
          <Radio value="loose">宽松</Radio>
        </Radio.Group>
      </div>

      <div className={styles.colSettingsSection}>
        <div className={styles.colSettingsSectionTitle}>显示项及排序</div>
        <div className={styles.colSettingsList}>
          {/* Fixed first column — no drag, switch disabled */}
          {fixed && (
            <div className={styles.colSettingsRow}>
              <span className={styles.dragPlaceholder} />
              <span className={styles.colName}>{fixed.title}</span>
              <Switch size="small" checked={false} disabled style={{ opacity: 0.35 }} />
            </div>
          )}
          {/* Draggable columns */}
          {draggable.map((item, i) => (
            <div
              key={item.key}
              className={[
                styles.colSettingsRow,
                dragIdx === i ? styles.colSettingsRowDragging : '',
                overIdx === i && dragIdx !== i ? styles.colSettingsRowOver : '',
              ].join(' ')}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={e => {
                e.preventDefault();
                setOverIdx(i);
              }}
              onDrop={() => {
                if (dragIdx !== null) reorder(dragIdx, i);
                setDragIdx(null);
                setOverIdx(null);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setOverIdx(null);
              }}
            >
              <HolderOutlined className={styles.dragHandle} />
              <span className={styles.colName}>{item.title}</span>
              <Switch
                size="small"
                checked={item.visible}
                onChange={checked => toggleVisible(i, checked)}
              />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
