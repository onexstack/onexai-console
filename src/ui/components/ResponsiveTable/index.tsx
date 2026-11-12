import type { ReactNode } from 'react';
import { Pagination, Table, type TableProps } from 'antd';
import type { ColumnType } from 'antd/es/table';

import { useIsMobile } from '../../responsive';
import { MobileCardList } from '../ResourcePage/mobile-card';

export interface ResponsiveTableProps<T extends object> extends Omit<TableProps<T>, 'columns'> {
  columns: NonNullable<TableProps<T>['columns']>;
  /** 卡片标题/主键用的字段。缺省取 `rowKey`（字符串形式）。 */
  idKey?: string;
  /**
   * 名称列的「显示名」字段：卡片标题回退到主键列时，用它补一行副标题。
   *
   * 与 `ResourcePage` 的 `resource.nameField` 同一含义（那里直接透传给
   * `MobileCardList`）。必须在这里显式解构，否则会被 `...tableProps` 透传到
   * 原生 `<table>` 上并触发未知属性警告。
   */
  nameField?: string;
  /** 卡片列表的空态文案。 */
  emptyText?: ReactNode;
}

/**
 * 原生 `antd Table` 的移动端包装：`< 768px` 自动换成 `ResourcePage` 那一套卡片列表。
 *
 * # 为什么需要它
 *
 * `ResourcePage` 驱动的 20 多个运营页已经自动卡片化，但仓里还有十来张**自绘表格**
 * （订单台、赠送管理、限额、审核日志…）。它们各自维护列定义与数据流，没法整体搬进
 * `ResourcePage`；这个薄包装让「换一个组件名」就获得同一套卡片能力，卡片字段仍然
 * 从各自的列定义推导（规则见 `ResourcePage/mobile-card.tsx`）。
 *
 * # 与 Table 的差异
 *
 * - 移动端忽略 `scroll` / `sticky` / `pagination` / `expandable` 等表格专属属性；
 *   卡片列表沿用调用方自己的分页（若有），没有分页时渲染全部行；
 * - `rowSelection` 的选中态会映射成卡片上的勾选框；
 * - `rowKey` 只支持字符串/数字字段（自绘表格都满足）；函数形式的 rowKey 在卡片模式
 *   下退化为行下标，**不要**依赖它做选中。
 */
export function ResponsiveTable<T extends object>({
  columns,
  dataSource,
  rowKey,
  loading,
  rowSelection,
  idKey,
  nameField,
  emptyText,
  ...tableProps
}: ResponsiveTableProps<T>) {
  const isMobile = useIsMobile();

  if (isMobile) {
    const keyField = idKey ?? (typeof rowKey === 'string' ? rowKey : 'id');
    const rows = (dataSource ?? []) as T[];
    const selectedKeys = (rowSelection?.selectedRowKeys ?? []).map(String);
    const selectedRows = rows.filter(row =>
      selectedKeys.includes(String((row as Record<string, unknown>)[keyField]))
    );
    const pager = tableProps.pagination;
    return (
      <>
        <MobileCardList<T>
          data={rows}
          columns={columns as unknown as ColumnType<T>[]}
          idKey={keyField}
          nameField={nameField}
          loading={Boolean(loading)}
          selectable={Boolean(rowSelection)}
          selectedKeys={selectedKeys}
          onSelectChange={keys => rowSelection?.onChange?.(keys, selectedRows, { type: 'none' })}
          emptyText={emptyText}
        />
        {/* 卡片模式也要能翻页：桌面那张表的分页在 Table 底部，卡片没有内置分页。 */}
        {pager !== false && typeof pager === 'object' && (pager.total ?? 0) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
            <Pagination
              simple
              size="small"
              current={pager.current ?? 1}
              pageSize={pager.pageSize ?? 20}
              total={pager.total ?? 0}
              onChange={(nextPage, nextSize) => pager.onChange?.(nextPage, nextSize)}
            />
          </div>
        )}
      </>
    );
  }

  return (
    <Table<T>
      columns={columns}
      dataSource={dataSource}
      rowKey={rowKey}
      loading={loading}
      rowSelection={rowSelection}
      {...tableProps}
    />
  );
}

export default ResponsiveTable;
