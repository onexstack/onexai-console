import type { TFunction } from 'i18next';

import type { MenuItem, RouteConfig } from '@/runtime';
import { RESOURCE_DEFS } from '@/api/resourceDefs';
import { isAdminOnlyPath } from '@/runtime/access';
import { normalizeOptionDescription } from '@/components/OptionLabel/helpers';

import type { SearchGroup, SearchItem, SearchSource } from './types';

/** 页面与动作两组用固定键，资源分组用资源键。 */
export const GROUP_ACTIONS = 'actions';
export const GROUP_PAGES = 'pages';

/** 每组最多展示多少条；总数封顶，避免一屏滚不完。 */
const MAX_PER_GROUP = 5;
const MAX_ACTIONS = 3;
const MAX_PAGES = 8;
const MAX_TOTAL = 40;
/** 单类资源最多参与匹配的行数：极端数据下也不把整面板撑爆。 */
const MAX_ROWS_PER_RESOURCE = 200;

type Row = Record<string, unknown>;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * 固定动作：都是前端导航，不需要任何接口。
 *
 * 「工作台」「账号设置」本身也是路由，构建「页面」分组时会按 path 去重，
 * 不让同一目的地出现两次。
 */
interface ActionDef {
  key: string;
  label: string;
  hint?: string;
  path: string;
}

const ACTIONS: ActionDef[] = [
  { key: 'new-chat', label: '新对话', hint: '打开智能体直聊', path: '/chat' },
  { key: 'workbench', label: '工作台', path: '/workbench' },
  { key: 'new-agent', label: '新建智能体', path: '/agents/new' },
  { key: 'account', label: '账号设置', path: '/account' },
];

interface FlatRoute {
  route: RouteConfig;
  path: string;
}

/** 把路由表压平成「完整路径 + 路由」，供页面与资源发现共用。 */
function flattenRoutes(routes: RouteConfig[], parent = ''): FlatRoute[] {
  const out: FlatRoute[] = [];
  for (const route of routes) {
    const path = route.path.startsWith('/')
      ? route.path
      : `${parent}/${route.path}`.replace(/\/+/g, '/');
    out.push({ route, path: path || '/' });
    if (route.children) out.push(...flattenRoutes(route.children, path));
  }
  return out;
}

/** 侧栏叶子项的路径顺序：用它决定资源分组出现的先后，符合用户的导航认知。 */
function menuPaths(menu: MenuItem[] | undefined): string[] {
  const out: string[] = [];
  const walk = (items: MenuItem[]) => {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const node = item as { key?: unknown; children?: unknown };
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children as MenuItem[]);
      } else if (typeof node.key === 'string' && node.key.startsWith('/')) {
        out.push(node.key);
      }
    }
  };
  walk(menu ?? []);
  return out;
}

/**
 * 从路由里发现可搜索的资源类型。
 *
 * 约束与列表页的约定一致：列表路由带 `meta.resourceKey` 且没有动态段，详情路由
 * 是同前缀的 `:id`。以后新增资源页只要照这个约定写，搜索自动纳入。
 */
export function discoverSources(
  routes: RouteConfig[],
  menu: MenuItem[] | undefined,
  isAdmin: boolean
): SearchSource[] {
  const flat = flattenRoutes(routes);
  const found = new Map<string, SearchSource>();

  for (const { route, path } of flat) {
    if (route.redirect || route.index || route.meta?.hidden) continue;
    if (!route.component || !route.meta?.title) continue;
    const key = route.meta.resourceKey;
    if (!key || path.includes(':') || found.has(key)) continue;
    const def = RESOURCE_DEFS[key];
    if (!def) continue;
    if (!isAdmin && isAdminOnlyPath(path)) continue;

    const detail = flat.find(
      item =>
        !item.route.redirect &&
        !item.route.index &&
        item.route.meta?.resourceKey === key &&
        item.path === `${path}/:id`
    );

    found.set(key, {
      key,
      listPath: path,
      detailTemplate: detail?.path,
      titleKey: route.meta.title,
      mode: def.listMode === 'page' ? 'page' : 'all',
    });
  }

  // 侧栏出现过的资源按侧栏顺序；只有路由、没有侧栏入口的（如 secrets）排在后面。
  const order = menuPaths(menu);
  return [...found.values()].sort((a, b) => {
    const ai = order.indexOf(a.listPath);
    const bi = order.indexOf(b.listPath);
    if (ai === bi) return 0;
    if (ai < 0) return 1;
    if (bi < 0) return -1;
    return ai - bi;
  });
}

/** 页面分组：可导航、非隐藏的页面路由（动作覆盖掉的 path 去重）。 */
export function pageItems(routes: RouteConfig[], isAdmin: boolean, t: TFunction): SearchItem[] {
  const actionPaths = new Set(ACTIONS.map(action => action.path));
  return flattenRoutes(routes)
    .filter(({ route, path }) => {
      if (route.redirect || route.index || route.meta?.hidden) return false;
      if (!route.component || !route.meta?.title) return false;
      if (path.includes(':') || actionPaths.has(path)) return false;
      return isAdmin || !isAdminOnlyPath(path);
    })
    .map(({ route, path }) => ({
      key: `page:${path}`,
      label: t(route.meta?.title ?? path),
      // 路径已经由右侧 Tag 展示，副行不再重复。
      path,
      groupKey: GROUP_PAGES,
      groupLabel: t('页面'),
    }));
}

/** 动作分组。 */
export function actionItems(t: TFunction): SearchItem[] {
  return ACTIONS.map(action => ({
    key: `action:${action.key}`,
    label: t(action.label),
    hint: action.hint ? t(action.hint) : undefined,
    path: action.path,
    groupKey: GROUP_ACTIONS,
    groupLabel: t('动作'),
  }));
}

/**
 * 资源行 → 搜索项。
 *
 * 只读白名单字段：id、名称、显示名、描述、命名空间。凭据类资源（secrets）的
 * `data` / `value` 等字段一律不读，只展示 id 与描述。
 */
export function rowItems(
  source: SearchSource,
  rows: Row[],
  namespace: string,
  t: TFunction
): SearchItem[] {
  const def = RESOURCE_DEFS[source.key];
  if (!def) return [];

  const out: SearchItem[] = [];
  for (const row of rows.slice(0, MAX_ROWS_PER_RESOURCE)) {
    const id = String(row[def.idKey] ?? '');
    if (!id) continue;

    const rowNamespace = str(row.namespace);
    // 空间筛选与列表页同口径；集群级资源（没有 namespace 字段）始终可见。
    if (namespace && rowNamespace && rowNamespace !== namespace) continue;

    const name = str(row.name);
    const label = str(row.displayName) ?? str(row.title) ?? name ?? id;
    const hint = name && name !== label ? name : rowNamespace || (id !== label ? id : undefined);
    const description =
      normalizeOptionDescription(row.description) ||
      normalizeOptionDescription(row.shortDesc) ||
      normalizeOptionDescription(row.summary);

    const path = source.detailTemplate
      ? source.detailTemplate.replace(':id', encodeURIComponent(id))
      : `${source.listPath}?search=${encodeURIComponent(label)}`;

    out.push({
      key: `row:${source.key}:${id}`,
      label,
      hint,
      description: description || undefined,
      path,
      groupKey: source.key,
      groupLabel: t(source.titleKey),
      namespace: rowNamespace,
    });
  }
  return out;
}

/**
 * 单个字段的匹配档位：越小越贴近用户意图。
 *
 * 0 完全相同 / 1 前缀 / 2 词边界 / 3 任意子串；不匹配返回 null。
 */
function textScore(text: string | undefined, keyword: string): number | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const index = lower.indexOf(keyword);
  if (index < 0) return null;
  if (lower === keyword) return 0;
  if (index === 0) return 1;
  return /[\s\-_/.:]/.test(lower[index - 1] ?? '') ? 2 : 3;
}

/**
 * 一项的总分：字段权重 + 该字段的匹配档位。
 *
 * 标题命中永远优于描述命中；同为标题时，精确 > 前缀 > 词边界 > 子串。
 */
function scoreItem(item: SearchItem, keyword: string): number | null {
  let best: number | null = null;
  const consider = (weight: number, text?: string) => {
    const score = textScore(text, keyword);
    if (score === null) return;
    const total = weight + score;
    if (best === null || total < best) best = total;
  };
  consider(0, item.label);
  consider(10, item.hint);
  consider(30, item.description);
  consider(40, item.namespace);
  consider(50, item.path);
  return best;
}

function pick(items: SearchItem[], keyword: string, limit: number): SearchItem[] {
  if (!keyword) return items.slice(0, limit);
  const scored: Array<{ item: SearchItem; score: number }> = [];
  for (const item of items) {
    const score = scoreItem(item, keyword);
    if (score !== null) scored.push({ item, score });
  }
  // 同分保持数据层顺序（资源行已按最新创建排好）。
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map(entry => entry.item);
}

function groupOf(
  key: string,
  label: string,
  items: SearchItem[],
  keyword: string,
  limit: number
): SearchGroup | null {
  const picked = pick(items, keyword, limit);
  return picked.length > 0 ? { key, label, items: picked } : null;
}

/**
 * 组装最终分组。
 *
 * 顺序固定：动作 → 页面 → 资源（按侧栏顺序）。没有关键字的资源组不展示，
 * 只给页面与动作，避免一聚焦就列出整库。
 */
export function buildGroups({
  actions,
  pages,
  resources,
  keyword,
  t,
}: {
  actions: SearchItem[];
  pages: SearchItem[];
  resources: SearchItem[];
  keyword: string;
  t: TFunction;
}): SearchGroup[] {
  const q = keyword.trim().toLowerCase();
  const groups: SearchGroup[] = [];

  const actionGroup = groupOf(GROUP_ACTIONS, t('动作'), actions, q, MAX_ACTIONS);
  if (actionGroup) groups.push(actionGroup);
  const pageGroup = groupOf(GROUP_PAGES, t('页面'), pages, q, q ? MAX_PER_GROUP : MAX_PAGES);
  if (pageGroup) groups.push(pageGroup);

  if (q) {
    const buckets = new Map<string, { label: string; items: SearchItem[] }>();
    for (const item of resources) {
      const bucket = buckets.get(item.groupKey);
      if (bucket) bucket.items.push(item);
      else buckets.set(item.groupKey, { label: item.groupLabel, items: [item] });
    }
    for (const [key, bucket] of buckets) {
      const group = groupOf(key, bucket.label, bucket.items, q, MAX_PER_GROUP);
      if (group) groups.push(group);
    }
  }

  const capped: SearchGroup[] = [];
  let total = 0;
  for (const group of groups) {
    if (total >= MAX_TOTAL) break;
    const items = group.items.slice(0, MAX_TOTAL - total);
    if (items.length === 0) continue;
    capped.push({ ...group, items });
    total += items.length;
  }
  return capped;
}
