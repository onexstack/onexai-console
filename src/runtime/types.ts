import type { ComponentType, ReactNode } from 'react';
import type { MenuProps } from 'antd';

import type { I18nConfig } from './i18n';

/** 路由元信息。`title` 同时是菜单文案与 i18n key。 */
export interface RouteMeta {
  title?: string;
  icon?: ReactNode;
  /** 不出现在菜单里（详情页等）。 */
  hidden?: boolean;
  /**
   * 这个路由渲染哪类资源。
   *
   * 列表/详情页从路径第一段取资源键；全局搜索（`GlobalSearch`）会扫描带
   * `resourceKey` 的列表路由自动发现可搜资源 —— 新增资源页照现有约定写上它，
   * 搜索就会自动纳入。
   */
  resourceKey?: string;
  /** 面包屑里显示的上层路径。 */
  parent?: { label: string; path: string };
}

export interface RouteConfig {
  /** 相对路径（`agents`）或绝对路径（`/agents`）。 */
  path: string;
  /** 懒加载页面组件。 */
  component?: () => Promise<{ default: ComponentType }>;
  /** 重定向目标。与 `index: true` 一起用时渲染 index 路由。 */
  redirect?: string;
  /** 索引路由。 */
  index?: boolean;
  meta?: RouteMeta;
  children?: RouteConfig[];
}

export type MenuItem = NonNullable<MenuProps['items']>[number];

export interface LayoutConfig {
  showHeader?: boolean;
  showSider?: boolean;
  siderWidth?: number;
  siderCollapsedWidth?: number;
  headerExtra?: ReactNode;
  siderHeader?: ReactNode;
  siderFooter?: ReactNode;
}

export interface ThemeConfig {
  primaryColor?: string;
  borderRadius?: number;
  /** 按钮圆角；不设置时跟随 `borderRadius`。火山引擎风格默认 6px。 */
  buttonBorderRadius?: number;
  /** 顶栏品牌标识：字符串按图片 URL 渲染，也可直接给节点。 */
  logo?: string | ReactNode;
}

/**
 * 应用配置。
 *
 * 与 onex-console 的 `SubAppConfig` 同形但更小：这里没有宿主身份（auth）、
 * 没有 keepAlive、没有 react-query——独立应用不需要为这些概念保留空壳。
 */
export interface AppConfig {
  name: string;
  /**
   * 部署前缀（如 `/onexai`），供独立部署在子路径时使用。
   * 为空表示应用挂在域根。宿主通过 Wujie 嵌入时以宿主的 `basePath` 为准。
   */
  base?: string;
  routes: RouteConfig[];
  /**
   * 侧栏导航，也是应用唯一的导航来源。
   *
   * 二级项直接写成 `children`：父级是 SubMenu，`key` 可以是合成值（如
   * `hub:capabilities`），只有叶子项的 `key` 才是真实路由。
   */
  menu?: MenuItem[];
  layout?: LayoutConfig;
  theme?: ThemeConfig;
  i18n: I18nConfig;
  homePath: string;
}

/** 提供类型提示的辅助函数，原样返回配置。 */
export function defineConfig(config: AppConfig): AppConfig {
  return config;
}
