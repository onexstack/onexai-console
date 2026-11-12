import type { MouseEvent, ReactNode } from 'react';
import { Checkbox, Empty, Spin } from 'antd';
import type { ColumnType } from 'antd/es/table';
import clsx from 'clsx';

import styles from './styles.module.scss';

/**
 * 移动端列表卡片：`ResourcePage` 在 `< 768px` 时用它替代宽表格。
 *
 * # 为什么不给 21 个调用点各写一份
 *
 * 每个描述符只声明「有哪些列、每列怎么渲染」。卡片需要的信息全都在这份列定义里，
 * 于是字段选择、标题、行操作都可以自动推导；调用方只在自动挑选不合适时才用
 * `mobileCard` 逃生舱或 `mobileHidden` / `mobilePriority` 注解干预。
 *
 * # 字段选择规则
 *
 * 1. 标题列：key/dataIndex 命中 `name / title / displayName / label / username /
 *    nickname` 的第一列；都没有时退回主键列。
 * 2. 正文字段：其余可见列里，按 `mobilePriority` 降序（未标注的按原顺序），
 *    排除 `mobileHidden`、`defaultHidden`、主键列与「看起来是长文本」的列
 *    （width > 240，或 key 命中 desc/content/body/summary/remark），最多 3 个。
 * 3. 行操作：`key === 'action'`（或 `'actions'`，仓里两种写法都有）的列原样渲染在
 *    卡片右上角。
 *
 * 这是一条**启发式**，不是契约：描述符一旦觉得挑错了，用注解或 `mobileCard` 覆盖，
 * 不要去改这里的分词表。
 */

/** 可以当卡片标题的字段名。 */
const TITLE_KEYS = ['name', 'title', 'displayName', 'label', 'username', 'nickname'];

/** 正文字段里排除的长文本列。 */
const LONG_TEXT_KEY_RE = /(desc|description|content|body|summary|remark|html|markdown)/i;

/** 带移动端注解的列定义：自绘表格用它给卡片挑字段（见 `pickMobileCardColumns`）。 */
export type MobileColumn<T> = ColumnType<T> & {
  /** 移动端卡片里不显示这一列。 */
  mobileHidden?: boolean;
  /** 移动端卡片的字段优先级，越大越靠前。 */
  mobilePriority?: number;
  /** 与 `ProTableColumn.defaultHidden` 同义：默认不出现在表格里的列也不进卡片。 */
  defaultHidden?: boolean;
};

function columnKeyOf<T>(column: ColumnType<T>): string {
  return String(
    column.key ??
      (Array.isArray(column.dataIndex) ? column.dataIndex.join('.') : column.dataIndex) ??
      ''
  );
}

/** 行操作列的 key：`action` 与 `actions` 在仓里并存（都表示「这一行的按钮」）。 */
function isActionKey(key: string): boolean {
  return key === 'action' || key === 'actions';
}

function looksLikeLongText<T>(column: ColumnType<T>): boolean {
  const width = typeof column.width === 'number' ? column.width : 0;
  return width > 240 || LONG_TEXT_KEY_RE.test(columnKeyOf(column));
}

function readValue<T>(record: T, column: ColumnType<T>): unknown {
  const { dataIndex } = column;
  if (Array.isArray(dataIndex)) {
    return dataIndex.reduce<unknown>((acc, key) => {
      if (acc === null || acc === undefined) return undefined;
      return (acc as Record<string, unknown>)[String(key)];
    }, record);
  }
  if (dataIndex === undefined || dataIndex === null) return undefined;
  return (record as Record<string, unknown>)[String(dataIndex)];
}

/** 与 antd Table 相同的单元格渲染：有 `render` 就用它，否则取 `dataIndex`。 */
export function renderCell<T>(column: ColumnType<T>, record: T, index: number): ReactNode {
  const value = readValue(record, column);
  if (column.render) {
    // antd 的 render 还允许返回 `{ children, props }`；卡片只要节点本身。
    return column.render(value, record, index) as ReactNode;
  }
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

export interface MobileCardColumns<T> {
  title: ColumnType<T> | null;
  fields: MobileColumn<T>[];
  action: ColumnType<T> | null;
}

/** 按上面的规则从列定义里挑出卡片用的三组列。 */
export function pickMobileCardColumns<T>(
  columns: ColumnType<T>[],
  idKey: string
): MobileCardColumns<T> {
  const action = columns.find(column => isActionKey(columnKeyOf(column))) ?? null;
  const candidates = columns.filter(column => column !== action);

  const title =
    candidates.find(column => TITLE_KEYS.includes(columnKeyOf(column))) ??
    candidates.find(column => columnKeyOf(column) === idKey) ??
    candidates[0] ??
    null;

  const fields = candidates
    .filter(column => column !== title && columnKeyOf(column) !== idKey)
    .map((column, order) => ({ column: column as MobileColumn<T>, order }))
    .filter(({ column }) => !column.mobileHidden && !column.defaultHidden)
    .filter(({ column }) => column.mobilePriority !== undefined || !looksLikeLongText(column))
    .sort(
      (a, b) => (b.column.mobilePriority ?? 0) - (a.column.mobilePriority ?? 0) || a.order - b.order
    )
    .slice(0, 3)
    .map(({ column }) => column);

  return { title, fields, action };
}

export interface MobileCardListProps<T> {
  data: T[];
  columns: ColumnType<T>[];
  /** 主键字段（同时也是 `rowKey`）。 */
  idKey: string;
  /** ID/名称单元格第二行的字段；标题回退到主键列时用它补一行小字。 */
  nameField?: string;
  loading?: boolean;
  selectable?: boolean;
  selectedKeys: string[];
  onSelectChange?: (keys: string[]) => void;
  onClickId?: (id: string, item: T, event: MouseEvent) => void;
  idHref?: (id: string, item: T) => string;
  emptyText: ReactNode;
}

export function MobileCardList<T extends object>({
  data,
  columns,
  idKey,
  nameField,
  loading,
  selectable,
  selectedKeys,
  onSelectChange,
  onClickId,
  idHref,
  emptyText,
}: MobileCardListProps<T>) {
  if (loading && data.length === 0) {
    return (
      <div className={styles.mobileCardLoading}>
        <Spin />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <Empty
        className={styles.mobileCardEmpty}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={emptyText}
      />
    );
  }

  const { title, fields, action } = pickMobileCardColumns(columns, idKey);
  const selected = new Set(selectedKeys.map(String));

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectChange?.(Array.from(next));
  };

  return (
    <div className={styles.mobileCards} data-testid="resource-mobile-cards">
      {data.map((record, index) => {
        const id = String((record as Record<string, unknown>)[idKey] ?? index);
        // 独立显示名列被合并进 ID/名称单元格后，标题会回退到主键列。此时不能直接
        // 渲染该列的节点：它内部已经有链接、复制和编辑按钮，外层再包一次 `<a>`
        // 会产生嵌套交互元素。这里只取纯文本两行，由下面的外层链接统一承载点击。
        const titleIsId = title !== null && columnKeyOf(title) === idKey;
        const titleNode = titleIsId ? (
          <span className={styles.mobileCardTitleStack}>
            <span>{id}</span>
            {nameField && (
              <span className={styles.mobileCardTitleSub}>
                {String((record as Record<string, unknown>)[nameField] ?? '') || '-'}
              </span>
            )}
          </span>
        ) : title ? (
          renderCell(title, record, index)
        ) : (
          id
        );
        const href = idHref?.(id, record);
        const handleOpen = (e: MouseEvent) => onClickId?.(id, record, e);

        return (
          <div
            key={id}
            className={styles.mobileCard}
            data-key={id}
            data-testid="resource-mobile-card"
          >
            <div className={styles.mobileCardHead}>
              {selectable && (
                <Checkbox
                  checked={selected.has(id)}
                  onChange={() => toggle(id)}
                  aria-label={`选择 ${id}`}
                />
              )}
              <div className={styles.mobileCardTitle}>
                {onClickId && !href ? (
                  <button type="button" className={styles.mobileCardTitleLink} onClick={handleOpen}>
                    {titleNode}
                  </button>
                ) : href ? (
                  <a className={styles.mobileCardTitleLink} href={href} onClick={handleOpen}>
                    {titleNode}
                  </a>
                ) : (
                  titleNode
                )}
              </div>
              {action && (
                <div className={styles.mobileCardActions}>{renderCell(action, record, index)}</div>
              )}
            </div>

            {fields.length > 0 && (
              <dl className={styles.mobileCardFields}>
                {fields.map(column => (
                  <div key={columnKeyOf(column)} className={styles.mobileCardField}>
                    <dt>{typeof column.title === 'string' ? column.title : columnKeyOf(column)}</dt>
                    <dd className={clsx(styles.mobileCardValue)}>
                      {renderCell(column, record, index)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}
