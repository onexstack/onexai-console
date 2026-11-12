import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { useAppConfig } from './hooks';
import type { MenuItem, RouteConfig } from './types';

/** 菜单节点的宽松结构，用于递归翻译 label。 */
type MenuNode = {
  label?: unknown;
  children?: MenuNode[];
  [key: string]: unknown;
};

/** 递归翻译菜单 label；找不到翻译时 i18next 原样返回 key。 */
function translateLabels(items: MenuItem[], t: TFunction): MenuItem[] {
  return items.map(item => {
    const node = item as unknown as MenuNode;
    const next: MenuNode = { ...node };
    if (typeof next.label === 'string') next.label = t(next.label);
    if (next.children) {
      next.children = translateLabels(
        next.children as unknown as MenuItem[],
        t
      ) as unknown as MenuNode[];
    }
    return next as unknown as MenuItem;
  });
}

/** 从路由配置生成菜单（仅在 `config.menu` 缺省时使用）。 */
export function generateMenuFromRoutes(routes: RouteConfig[], parentPath = ''): MenuItem[] {
  return routes
    .filter(route => {
      if (route.meta?.hidden) return false;
      if (!route.meta?.title && !route.children?.length) return false;
      if (route.redirect) return false;
      if (route.index) return false;
      return true;
    })
    .map(route => {
      const fullPath = route.path.startsWith('/')
        ? route.path
        : `${parentPath}/${route.path}`.replace(/\/+/g, '/');
      const item = {
        key: fullPath,
        icon: route.meta?.icon,
        label: route.meta?.title || route.path,
      } as MenuItem;
      if (route.children?.length) {
        const children = generateMenuFromRoutes(route.children, fullPath);
        if (children.length > 0) return { ...item, children } as MenuItem;
      }
      return item;
    });
}

/**
 * 选出与当前路径最匹配的菜单叶子 key。
 *
 * 侧栏的叶子既可能是单段路径（`/models`），也可能是多段路径
 * （`/observability/runs`）。只按第一段反查会把子页错误高亮成父页，所以这里
 * 取「路径段边界上匹配的最长 key」：
 *
 * - `/observability/runs` 命中 `/observability/runs`，不是 `/observability`；
 * - `/observabilityx` 不会命中 `/observability`（边界必须是 `/`）；
 * - `/agents/:id` 仍命中 `/agents`。
 *
 * 找不到时返回 undefined，由调用方回退到第一段路径（避免 `/account` 这类
 * 不在菜单里的页面被错误高亮）。传入的必须是**过滤后**的菜单，否则非管理员
 * 会按隐藏项计算选中态。
 */
export function matchMenuPathKey(items: MenuItem[], pathname: string): string | undefined {
  const target = pathname.replace(/\/+$/, '') || '/';
  let best: string | undefined;

  const visit = (nodes: MenuItem[]) => {
    for (const item of nodes) {
      if (!item || typeof item !== 'object') continue;
      const node = item as { key?: unknown; children?: MenuItem[] };
      if (node.children?.length) {
        visit(node.children);
        continue;
      }
      if (typeof node.key !== 'string' || !node.key.startsWith('/')) continue;
      const key = node.key.replace(/\/+$/, '') || '/';
      const matched = target === key || target.startsWith(key === '/' ? '/' : `${key}/`);
      if (matched && (!best || key.length > best.length)) best = key;
    }
  };

  visit(items);
  return best;
}

/** 当前语言的菜单配置。 */
export function useMenu(): MenuItem[] {
  const config = useAppConfig();
  const { t } = useTranslation();

  return useMemo(() => {
    const base =
      config.menu && config.menu.length > 0 ? config.menu : generateMenuFromRoutes(config.routes);
    return translateLabels(base, t);
  }, [config.menu, config.routes, t]);
}
