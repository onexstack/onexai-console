import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getRunMonitor } from '@/api/agentMonitor';
import { getStuckRuns, listAgentRuns } from '@/api/agentRuns';
import { fetchAllRows, resourceRowsQueryKey } from '@/api/resourceDefs';
import type { PlatformAgent } from '@/api/types';
import {
  AUTO_REFRESH_MS,
  monitorRangeDef,
  monitorWindow,
  type MonitorRangeKey,
} from '@/components/metrics';

const PAGE_SIZE = 20;

export function useRunMonitor({
  range,
  agent,
  autoRefresh,
  enabled,
}: {
  range: MonitorRangeKey;
  agent: string;
  autoRefresh: boolean;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: ['observability', 'monitor', range, agent || 'all'],
    queryFn: () => {
      // from/to 现算，不能进 queryKey：否则每次渲染都会得到一个新 key。
      const window = monitorWindow(monitorRangeDef(range));
      return getRunMonitor({
        ...(agent ? { agent } : { all: true }),
        ...window,
        limit: 10,
      });
    },
    enabled,
    // 5 个 TAB 共用这一个 key；切换页面不重复扫描。
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
  });
}

export function useAgentCatalog(enabled: boolean) {
  const query = useQuery({
    queryKey: resourceRowsQueryKey('agents'),
    queryFn: () => fetchAllRows('agents'),
    enabled,
    staleTime: 60_000,
  });

  const agents = useMemo(() => (query.data ?? []) as unknown as PlatformAgent[], [query.data]);
  return { ...query, agents };
}

export function useFailedRuns({
  range,
  agent,
  page,
  autoRefresh,
  enabled,
}: {
  range: MonitorRangeKey;
  agent: string;
  page: number;
  autoRefresh: boolean;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: ['observability', 'failures', range, agent || 'all', page],
    queryFn: () => {
      const window = monitorWindow(monitorRangeDef(range));
      return listAgentRuns({
        state: 'failed',
        agent: agent || undefined,
        from: window.from,
        to: window.to,
        offset: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      });
    },
    enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
  });
}

export function useStuckRuns({
  agent,
  autoRefresh,
  enabled,
}: {
  agent: string;
  autoRefresh: boolean;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: ['observability', 'stuck', agent || 'all'],
    queryFn: () => getStuckRuns({ agent: agent || undefined, limit: 50 }),
    enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
  });
}

export const FAILURE_PAGE_SIZE = PAGE_SIZE;
