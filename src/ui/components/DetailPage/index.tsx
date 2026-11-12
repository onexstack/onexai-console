import { useState, type ReactNode } from 'react';
import { Button, Input, InputNumber, Select, Switch, message } from 'antd';
import { EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import clsx from 'clsx';
import { CopyButton } from '../CopyButton';
import { FieldHint } from '../FieldHint';
import styles from './styles.module.scss';

/**
 * 内联编辑控件类型。
 *
 * 值统一以**字符串**在 `EditConfig` 里流转（`currentValue` / `onSave` / `renderEdit`
 * 都是 string）：这样这个组件不需要泛型，number / boolean / 数组 由调用方各自
 * 序列化与解析。需要更复杂的控件时用 `'custom'` + `renderEdit` 自绘。
 */
export type EditControlType =
  'input' | 'select' | 'number' | 'switch' | 'textarea' | 'tags' | 'custom';

export interface EditConfig {
  /** 编辑控件；缺省 `'input'`。`'custom'` 时必须给 `renderEdit`。 */
  type?: EditControlType;
  options?: { label: string; value: string }[];
  /** 编辑态初值（字符串形态） */
  currentValue: string;
  onSave: (newValue: string) => Promise<void>;
  /** `type === 'custom'`：自绘编辑控件 */
  renderEdit?: (value: string, onChange: (next: string) => void) => ReactNode;
  /** 文本控件的最大长度（列表内改名等场景与表单保持一致）。 */
  maxLength?: number;
  /**
   * 编辑态占满一行（Markdown、列表、结构化编辑器等）。
   *
   * 它同时把该条 `InfoItem` 撑到两列宽——长内容本来就不适合挤在半栏里。
   */
  wide?: boolean;
  /** 保存前校验；返回非空字符串则不保存，并把它当错误提示弹出。 */
  validate?: (value: string) => string | undefined;
  /**
   * 修改这个字段会发生什么（例如「清空即为删除」这类契约说明）。
   *
   * 与 `InfoItem.hint` 一起渲染成字段名旁的那个问号——两层都写时以 `InfoItem.hint`
   * 为准（`InfoSection` 里做合并）。见 `FieldHint`。
   */
  hint?: ReactNode;
}

export interface InfoItem {
  label: string;
  value: ReactNode;
  rawValue?: string;
  copyable?: boolean;
  editable?: EditConfig;
  /** 2 = full-width row across both columns */
  span?: 1 | 2;
  /**
   * 这个字段的值是一整块内容（计算器、面板等），不是一段行内文本。
   *
   * 展示态默认把值包在一个 `inline-flex` 里（编辑/复制按钮贴着内容），它会按内容
   * 宽度收缩——整块面板放进去就只占半栏。置真时换成撑满整行的 `flex`。
   */
  block?: boolean;
  /** 这个字段是什么。渲染成字段名旁的问号（`FieldHint`），不再铺在值右侧。 */
  hint?: ReactNode;
  /**
   * 展示态值右侧的额外操作（按钮等）。编辑态刻意不渲染：编辑中的字段只应有保存/取消，
   * 否则同一字段会同时存在两个写入口。
   */
  actions?: ReactNode;
}

/** `'tags'` 控件的值在字符串里按 JSON 数组存。 */
function parseTags(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function EditControl({
  editable,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  editable: EditConfig;
  value: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  // 单行控件上的 Enter 提交、Escape 取消（沿用本组件一直以来的手感）。
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onCommit();
    if (e.key === 'Escape') onCancel();
  };

  switch (editable.type) {
    case 'custom':
      return <>{editable.renderEdit?.(value, onChange)}</>;
    case 'select':
      return (
        <Select
          value={value === '' ? undefined : value}
          onChange={next => onChange(next ?? '')}
          options={editable.options}
          size="small"
          style={{ minWidth: 120 }}
          autoFocus
        />
      );
    case 'number':
      return (
        <InputNumber
          value={value === '' ? null : Number(value)}
          onChange={next => onChange(next === null || next === undefined ? '' : String(next))}
          onKeyDown={keys}
          size="small"
          style={{ minWidth: 120 }}
          autoFocus
        />
      );
    case 'switch':
      return (
        <Switch checked={value === 'true'} onChange={next => onChange(String(next))} size="small" />
      );
    case 'tags':
      return (
        <Select
          mode="tags"
          value={parseTags(value)}
          onChange={next => onChange(JSON.stringify(next))}
          tokenSeparators={[',', '，', '\n']}
          size="small"
          style={{ minWidth: 240 }}
          autoFocus
        />
      );
    case 'textarea':
      return (
        <Input.TextArea
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') onCancel();
          }}
          maxLength={editable.maxLength}
          rows={3}
          autoFocus
        />
      );
    default:
      return (
        <Input
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={keys}
          maxLength={editable.maxLength}
          size="small"
          className={styles.editInput}
          autoFocus
        />
      );
  }
}

export function ValueWithActions({
  value,
  rawValue,
  copyable,
  copyAriaLabel,
  editable,
  block,
  actions: extraActions,
  revealActionsOnHover,
}: {
  value: ReactNode;
  rawValue?: string;
  copyable?: boolean;
  /** 复制按钮的无障碍名；同一屏有多个复制入口时用来区分（如「复制 ID」「复制名称」）。 */
  copyAriaLabel?: string;
  editable?: EditConfig;
  /** 值是整块内容，展示态让它撑满整行（见 `InfoItem.block`）。 */
  block?: boolean;
  /** 展示态值右侧的额外操作；编辑态不渲染（见 `InfoItem.actions`）。 */
  actions?: ReactNode;
  /**
   * 展示态的铅笔/复制按钮只在**悬停或聚焦**时出现。
   *
   * 列表里的名称用它：铅笔一直亮着会让每一行都像「可编辑表单」，而它其实是一次
   * 低频操作（腾讯云控制台的列表就是悬停才现）。用 `opacity` 而不是 `display:none`
   * 隐藏——按钮保持可聚焦，键盘 Tab 到它时也会显形。
   */
  revealActionsOnHover?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setEditVal(editable?.currentValue ?? '');
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setEditVal('');
  };

  const save = async () => {
    if (!editable) return;
    const invalid = editable.validate?.(editVal);
    if (invalid) {
      message.error(invalid);
      return;
    }
    setSaving(true);
    try {
      await editable.onSave(editVal);
      setEditing(false);
    } catch {
      // 保存失败由调用方负责提示（它才知道是权限、校验还是网络）；这里只负责
      // **保持编辑态**，让用户改完还能再试一次。顺带吞掉 rejection —— 否则
      // `onClick={() => void save()}` 会变成一次无人处理的 unhandled rejection。
    } finally {
      setSaving(false);
    }
  };

  const actions = (
    <>
      <Button
        type="text"
        size="small"
        icon={<CheckOutlined style={{ color: 'var(--color-success, #52c41a)', fontSize: 12 }} />}
        onClick={() => void save()}
        loading={saving}
        className={styles.actionBtn}
        aria-label="保存"
      />
      <Button
        type="text"
        size="small"
        icon={<CloseOutlined style={{ color: 'var(--color-error, #ff4d4f)', fontSize: 12 }} />}
        onClick={cancel}
        className={styles.actionBtn}
        aria-label="取消"
      />
    </>
  );

  if (editing && editable) {
    const control = (
      <EditControl
        editable={editable}
        value={editVal}
        onChange={setEditVal}
        onCommit={() => void save()}
        onCancel={cancel}
      />
    );

    // 窄控件沿用原来的行内形态；宽控件（Markdown / 列表 / 结构化）另起一行，
    // 否则半栏宽度里根本放不下。
    if (editable.wide) {
      return (
        <div className={styles.wideEditor}>
          <div className={styles.wideEditorControl}>{control}</div>
          <div className={styles.wideEditorActions}>{actions}</div>
        </div>
      );
    }

    return (
      <span className={styles.valueWithActions}>
        {control}
        {actions}
      </span>
    );
  }

  return (
    <span
      className={clsx(
        styles.valueWithActions,
        block && styles.valueWithActionsBlock,
        revealActionsOnHover && styles.hoverReveal
      )}
    >
      <span>{value}</span>
      {extraActions}
      {copyable && (
        <CopyButton
          value={rawValue ?? String(value ?? '')}
          ariaLabel={copyAriaLabel}
          className={styles.actionBtn}
        />
      )}
      {editable && (
        <Button
          type="text"
          size="small"
          icon={<EditOutlined style={{ fontSize: 12 }} />}
          onClick={startEdit}
          className={styles.actionBtn}
          aria-label="编辑"
        />
      )}
    </span>
  );
}

/**
 * 区块标题（`InfoSection` 的段标题）。
 *
 * 单独导出是因为**不止 `InfoSection` 需要它**：宿主「新建商品」页的分组标题
 * （`AdminProducts/create.tsx`）原本自己抄了一份同样的值，抄的时候漏掉了
 * `text-transform` 与 `letter-spacing` —— 注释写着「同一副长相」，实际不是。
 * 让两边用同一个组件，它就不可能再漂。
 */
export function SectionHeader({ title, className }: { title: ReactNode; className?: string }) {
  return <div className={clsx(styles.sectionHeader, className)}>{title}</div>;
}

export function InfoSection({
  title,
  items,
  actions,
}: {
  /**
   * 段标题。`ReactNode` 而不是 `string`，为的是调用方能只改这一处的排版（例如块标题是
   * 一个产品名、不该跟着段标题的 `text-transform: uppercase` 走）—— 套一层 span 就够了，
   * 不必去覆盖 ui 包里的类名。
   */
  title: ReactNode;
  items: InfoItem[];
  /**
   * 段标题右侧的操作（按钮等）。
   *
   * 做成槽位而不是让调用方在外面自己拼一行：段标题下面那条分隔线、它与标题的对齐、
   * 以及「段与段之间 28px」的节奏都在这一套样式里 —— 拼在外面就有了第二份「段头」，
   * 两份迟早会漂（`SectionHeader` 上面那段注释记的就是这个坑的一次实例）。
   */
  actions?: ReactNode;
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeaderRow}>
        <SectionHeader title={title} className={styles.sectionHeaderGrow} />
        {actions}
      </div>
      <div className={styles.grid}>
        {items.map(item => {
          const wide = item.span === 2 || item.editable?.wide === true;
          // 顶层 `hint`（这个字段是什么）与 `editable.hint`（改它会怎样）说的是同一件
          // 事的两个侧面，所以合成一处、画在字段名旁边。这么做还顺手修掉一个可发现性
          // 问题：`editable.hint` 从前只画在编辑器下方，不点开 ✎ 根本看不见。
          const hint = item.hint ?? item.editable?.hint;
          return (
            <div
              key={item.label}
              className={clsx(styles.item, wide && styles.itemWide)}
              style={wide ? { gridColumn: 'span 2' } : undefined}
            >
              <span className={styles.label}>
                {item.label}
                <FieldHint>{hint}</FieldHint>
              </span>
              <span className={styles.value}>
                <ValueWithActions
                  value={item.value}
                  rawValue={item.rawValue}
                  copyable={item.copyable}
                  editable={item.editable}
                  block={item.block}
                  actions={item.actions}
                />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
