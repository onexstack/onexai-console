/**
 * 列表页表格布局的**唯一契约**。所有一级列表页的表格都必须遵守本节五条。
 *
 * # 1. 整表铺满内容区
 *
 * 表格展开 `RESOURCE_TABLE_LAYOUT`（`scroll.x = 'max-content'` + `tableLayout = 'auto'`），
 * 且**不得**压掉 antd 写在 `<table>` 上的内联 `min-width: 100%`。
 *
 * `min-width: 100%` 不是随手写下的：它保证表格至少铺满卡片，多出的宽度由 auto 布局
 * 吸收到各列，**操作列的右缘才可能与内容区右缘重合**。曾有一版用
 * `min-width: 0 !important` 把表缩成内容宽度，结果操作列停在页面中途、右侧留一大片
 * 空白；而内容一旦宽于卡片，操作列又会溢出卡片、被推到视口边缘。不要再走这条路。
 *
 * # 2. 操作列固定贴内容区右缘
 *
 * 操作列永远是最后一列，展开 `RESOURCE_ACTION_COLUMN`：固定宽度 +
 * `fixed: 'right'` + `align: 'right'`。任何窗口宽度下它都吸附在内容区右缘；内容超宽时
 * 表格在卡片内部横向滚动，操作列不移动、也不会被裁切。
 *
 * # 3. ID / 名称列给足宽度
 *
 * `width: RESOURCE_ID_COLUMN_WIDTH`，列内无界文本用
 * `EllipsisText maxWidth={RESOURCE_ID_TEXT_MAX_WIDTH}` 截断（扣掉左右单元格内边距与
 * 复制按钮）。不要在调用点写 190 / 220 之类的魔数——那是列宽的一部分，会随列宽一起漂移。
 *
 * # 4. 其余列按内容自动计算宽度
 *
 * 中间列的宽度交给 `table-layout: auto` 按内容计算：列宽优先保证**内容展示全**，
 * 不要用列级 `ellipsis` 截断。只有内容长度有界的语义列（状态、时间、开关、固定枚举）
 * 可以给一个偏好宽度；**不要**为了「把表撑满」而给文本列固定宽度。真正无界的长文本
 * （URL、长 ID、长描述）在**单元格内部**用 `EllipsisText` 限宽，而不是压窄列宽。
 *
 * # 5. 移动端
 *
 * 自绘表格用 `ResponsiveTable`（`< 768px` 自动切卡片）；`ResourcePage` 已内置同样的切换。
 *
 * 说明：`RESOURCE_ID_COLUMN_WIDTH` 不再受「移动端卡片阈值」约束。ID 列在
 * `pickMobileCardColumns` 里永远按 `idKey` 命中被当作卡片标题，不参与正文字段筛选，
 * 所以加宽它不会把标题挤出移动端卡片。
 */

export const RESOURCE_TABLE_LAYOUT = {
  scroll: { x: 'max-content' },
  tableLayout: 'auto',
} as const;

/**
 * 标准「ID/名称」列的宽度。
 *
 * auto 布局下它只是**偏好宽度**：内容更宽时列会按内容撑开，因此不会被裁切。
 */
export const RESOURCE_ID_COLUMN_WIDTH = 280;

/**
 * ID/名称单元格里文本的可视上限。
 *
 * = 列宽 − 左右单元格内边距（10px × 2）− 悬停复制按钮及其间距（约 28px）。
 * 单元格内容（含复制/改名按钮）超过这个宽度就会把列撑开，所以无界文本必须在
 * 单元格内部按它截断。见 `EllipsisText`。
 */
export const RESOURCE_ID_TEXT_MAX_WIDTH = RESOURCE_ID_COLUMN_WIDTH - 48;

/**
 * 标准「创建时间 / 更新时间」列的偏好宽度。
 *
 * `formatDate` 默认 `YYYY-MM-DD HH:mm:ss`（19 字符，13px 下约 130px），加左右单元格
 * 内边距 20px 后给到 160px。时间单元格内部还要 `white-space: nowrap`——换行的时间
 * 无法纵向对齐，列表会显得毛糙。
 */
export const RESOURCE_TIME_COLUMN_WIDTH = 160;

/**
 * 标准「操作」列的偏好宽度。
 *
 * auto 布局下这只是起点：动作较多（例如定时任务的「立即运行 / 暂停 / 删除 / 更多」）
 * 时列会按内容撑开，不会裁切。
 */
export const RESOURCE_ACTION_COLUMN_WIDTH = 160;

/**
 * 操作列的完整预设：调用方只需再给 `title` / `key` / `render`。
 *
 * ```tsx
 * { title: '操作', key: 'actions', ...RESOURCE_ACTION_COLUMN, render: ... }
 * ```
 */
export const RESOURCE_ACTION_COLUMN = {
  width: RESOURCE_ACTION_COLUMN_WIDTH,
  fixed: 'right',
  align: 'right',
} as const;
