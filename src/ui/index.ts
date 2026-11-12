/**
 * 本应用消费的 UI 组件子集。
 *
 * 这些组件与 onex-console 的 `@onex-console/ui` 同源（2026-11-06 拆分时抽取），
 * 只保留智能体平台实际用到的部分：通用列表 / 详情外壳、字段展示、响应式表格。
 * 两边没有生成器兜底，改行为时需同步。
 */
export { default as ResourcePage } from './components/ResourcePage';
export { default as DetailShell } from './components/DetailShell';
export { default as PageHeader } from './components/PageHeader';
export type { PageHeaderProps } from './components/PageHeader';
export { default as PageSurface } from './components/PageSurface';
export type { PageSurfaceProps } from './components/PageSurface';
export { default as MoreActions } from './components/MoreActions';
export type { MoreActionsProps } from './components/MoreActions';
export { default as EllipsisText } from './components/EllipsisText';
export type { EllipsisTextProps } from './components/EllipsisText';
export { default as ResizableDrawer } from './components/ResizableDrawer';
export type { ResizableDrawerProps } from './components/ResizableDrawer';
export {
  RESOURCE_ACTION_COLUMN,
  RESOURCE_ACTION_COLUMN_WIDTH,
  RESOURCE_ID_COLUMN_WIDTH,
  RESOURCE_ID_TEXT_MAX_WIDTH,
  RESOURCE_TABLE_LAYOUT,
  RESOURCE_TIME_COLUMN_WIDTH,
} from './components/ProTable/layout';
export { ResponsiveTable } from './components/ResponsiveTable';
export { default as ColumnSettingsModal } from './components/ColumnSettings';
export { mergeColumnOrder } from './components/ColumnSettings/order';
export type {
  ColItem,
  ColumnLayout,
  ColumnSettingsModalProps,
} from './components/ColumnSettings/types';
export { SearchTagInput } from './components/SearchTagInput';
export type { SearchTag, SearchTagInputProps } from './components/SearchTagInput';
export type { MobileColumn } from './components/ResourcePage/mobile-card';
export { SparkleIcon } from './components/SparkleIcon';
export { default as StatusSwitch, isSwitchOn } from './components/StatusSwitch';
export type {
  StatusSwitchConfirm,
  StatusSwitchProps,
  SwitchMapping,
} from './components/StatusSwitch';
export { InfoSection, SectionHeader, ValueWithActions } from './components/DetailPage';
export type { EditConfig, InfoItem } from './components/DetailPage';
export { ResourceNameCell } from './components/ResourceNameCell';
export type { ResourceNameCellProps } from './components/ResourceNameCell';
export { SecretValue } from './components/SecretValue';
export type { SecretValueProps } from './components/SecretValue';
export type { ProTableColumn } from './components/ProTable';
export type {
  ReadOnlyResourceApi,
  ResourceApi,
  ResourceApiShape,
  ResourceDescriptor,
  ResourceListFilters,
} from './types';
export { createThemeConfig } from './theme';
export { useIsMobile, useBreakpoint } from './responsive';
