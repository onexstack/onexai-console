import type { DefaultOptionType } from 'antd/es/select';

/**
 * 宿主或其它组件要求打开搜索的全局事件。
 *
 * 保留旧版 `QuickJump` 的事件名：嵌入方（Wujie 宿主）可能还在派发它。
 */
export const QUICK_JUMP_EVENT = 'onexai:quick-jump';

/** 搜索结果里的一项。页面、动作、资源实例共用同一种形状。 */
export interface SearchItem {
  /** 全局唯一（`page:/agents`、`row:agents:foo`），同时用作 option.value。 */
  key: string;
  /** 主标题：资源用 displayName/title/name，页面用路由标题。 */
  label: string;
  /** 副行左侧：资源的 name、工单号、路径等。 */
  hint?: string;
  /** 副行正文：资源描述。 */
  description?: string;
  /** 打开这一项要去的地址。 */
  path: string;
  /** 分组键与分组标题。 */
  groupKey: string;
  groupLabel: string;
  /** 行自带的命名空间（页面/动作为空）。 */
  namespace?: string;
}

export interface SearchGroup {
  key: string;
  label: string;
  items: SearchItem[];
}

/**
 * 由路由发现的「可搜索资源」。
 *
 * 只描述怎么读、怎么拼详情地址，不绑定具体资源；新增资源页只要在路由上写
 * `meta.resourceKey`，搜索会自动纳入。
 */
export interface SearchSource {
  /** 资源键，同时也是 `RESOURCE_DEFS` 的键。 */
  key: string;
  /** 列表页地址，如 `/agents`。 */
  listPath: string;
  /** 详情路由模板，如 `/agents/:id`；没有详情页时为 undefined。 */
  detailTemplate?: string;
  /** 分组标题的 i18n key（就是路由的 `meta.title`）。 */
  titleKey: string;
  /** `page` 模式的资源（目前只有工单）走服务端分页，不能全量读取。 */
  mode: 'all' | 'page';
}

/** AutoComplete 的 option：带上原始项，供 `optionRender` / `onSelect` 使用。 */
export type SearchOptionData = DefaultOptionType & { searchItem: SearchItem };
