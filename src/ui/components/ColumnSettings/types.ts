/** 行密度：紧凑 = `Table size="small"`，宽松 = `size="middle"`。 */
export type ColumnLayout = 'compact' | 'loose';

export interface ColItem {
  key: string;
  title: string;
  visible: boolean;
  /** 固定列（ID/名称）：始终显示，不可拖动。 */
  fixed?: boolean;
}

export interface ColumnSettingsModalProps {
  open: boolean;
  layout: ColumnLayout;
  items: ColItem[];
  onOk: (layout: ColumnLayout, items: ColItem[]) => void;
  onCancel: () => void;
}
