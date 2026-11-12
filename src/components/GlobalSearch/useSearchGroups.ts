import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';

import { useAppConfig, useNamespace, useTranslation } from '@/runtime';
import { fetchAllRows, resourceRowsQueryKey } from '@/api/resourceDefs';
import { ticketApi } from '@/api/chat';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';

import { actionItems, buildGroups, discoverSources, pageItems, rowItems } from './sources';
import type { SearchGroup, SearchItem } from './types';

export interface UseSearchGroupsResult {
  groups: SearchGroup[];
  /** 有关键字且还有资源没回来。 */
  loading: boolean;
  /** 当前生效的业务空间（空字符串 = 全部空间）。 */
  namespace: string;
}

type Row = Record<string, unknown>;

/**
 * 「正在搜索资源…」的展示上限。
 *
 * 列表接口偶尔会卡住（例如本机 memories / scheduledruns 依赖的下游），而同一个
 * 缓存键可能早被别的页面发起、我们只是观察者，没法单独给它加超时。到点后收起
 * 加载提示，已拿到的分组照常展示；提示消失不代表数据一定全了。
 */
const LOADING_HINT_MS = 8_000;

/**
 * 全局搜索的数据源。
 *
 * # 为什么不发"搜索请求"
 *
 * 后端没有跨资源的搜索接口；列表接口本身就是全量视图（`limit=0`），并且与
 * 列表页共用 `['res', key, 'all']` 缓存。这里只在**有输入**时并发读取各类资源
 * 的全量行，再在客户端过滤 —— 焦点落在输入框时不会产生任何请求。
 *
 * 单个资源失败只让该分组消失，不影响其它分组（与旧版智能体查询的静默降级一致）。
 */
export function useSearchGroups(keyword: string): UseSearchGroupsResult {
  const config = useAppConfig();
  const { t } = useTranslation();
  const token = useSessionToken();
  const isAdmin = useMemo(() => decodeClaims(token)?.isAdmin === true, [token]);
  const namespace = useNamespace();
  const active = keyword.trim().length > 0;

  const sources = useMemo(
    () => discoverSources(config.routes, config.menu, isAdmin),
    [config.routes, config.menu, isAdmin]
  );
  // `listMode: 'page'` 的资源（工单）不能全量读，单独走一条分页查询。
  const listSources = useMemo(() => sources.filter(source => source.mode === 'all'), [sources]);
  const ticketSource = useMemo(() => sources.find(source => source.mode === 'page'), [sources]);

  const rowsQueries = useQueries({
    queries: listSources.map(source => ({
      queryKey: resourceRowsQueryKey(source.key),
      queryFn: () => fetchAllRows(source.key),
      staleTime: 60_000,
      // 一次失败就是一个必然 403/404 的分组，重试只会放大噪声。
      retry: false,
      enabled: active,
    })),
  });

  const ticketsQuery = useQuery({
    queryKey: ['res', 'tickets', 'search-page'],
    queryFn: () => ticketApi.list({ page: 1, pageSize: 50 }),
    staleTime: 60_000,
    retry: false,
    enabled: active && Boolean(ticketSource),
  });

  const resources = useMemo(() => {
    const items: SearchItem[] = [];
    listSources.forEach((source, index) => {
      const rows = rowsQueries[index]?.data;
      if (rows?.length) items.push(...rowItems(source, rows, namespace, t));
    });
    if (ticketSource && ticketsQuery.data?.items.length) {
      items.push(...rowItems(ticketSource, ticketsQuery.data.items as unknown as Row[], '', t));
    }
    return items;
  }, [listSources, rowsQueries, ticketSource, ticketsQuery.data, namespace, t]);

  const actions = useMemo(() => actionItems(t), [t]);
  const pages = useMemo(() => pageItems(config.routes, isAdmin, t), [config.routes, isAdmin, t]);
  const groups = useMemo(
    () => buildGroups({ actions, pages, resources, keyword, t }),
    [actions, pages, resources, keyword, t]
  );

  const pending =
    active && (rowsQueries.some(query => query.isFetching) || ticketsQuery.isFetching);

  // 卡住的共享查询不能把提示永远挂在那里：到点后按「没有更多了」处理。
  const [hintExpired, setHintExpired] = useState(false);
  useEffect(() => {
    setHintExpired(false);
    if (!pending) return;
    const timer = window.setTimeout(() => setHintExpired(true), LOADING_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [pending, keyword]);

  // 已经有结果时不再提示加载：部分共享查询可能长期卡住，提示反而像故障。
  const loading = pending && !hintExpired && groups.length === 0;

  return { groups, loading, namespace };
}
