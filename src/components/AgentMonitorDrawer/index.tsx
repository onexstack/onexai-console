import { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Segmented, Skeleton, Space, Switch, Tabs } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';

import { getRunMonitor } from '@/api/agentMonitor';
import type { PlatformAgent } from '@/api/types';
import {
  AUTO_REFRESH_MS,
  DEFAULT_MONITOR_RANGE,
  EmptyBlock,
  MONITOR_RANGES,
  OverviewSection,
  PerformanceSection,
  TokenSection,
  monitorRangeDef,
  monitorWindow,
  type ChartTheme,
  type MonitorRangeKey,
} from '@/components/metrics';
import { formatDate } from '@/lib/date';
import { ResizableDrawer, useIsMobile } from '@/ui';
import { useThemeState } from '@/runtime';
import RunsHealthSection from './sections/RunsHealthSection';
import styles from './styles.module.scss';

export interface MonitorDrawerProps {
  open: boolean;
  agentName: string;
  agent?: PlatformAgent;
  onClose: () => void;
}

export default function MonitorDrawer({ open, agentName, agent, onClose }: MonitorDrawerProps) {
  const isMobile = useIsMobile();
  const theme: ChartTheme = useThemeState().resolved;
  const [range, setRange] = useState<MonitorRangeKey>(DEFAULT_MONITOR_RANGE);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [tab, setTab] = useState('overview');

  const query = useQuery({
    queryKey: ['agent-monitor', agentName, range],
    queryFn: () => {
      const rangeWindow = monitorWindow(monitorRangeDef(range));
      return getRunMonitor({ agent: agentName, ...rangeWindow, limit: 10 });
    },
    enabled: open && Boolean(agentName),
    staleTime: 10_000,
    // 切换时间范围时保留上一份数据，图表不闪空；但换了智能体就必须清空，
    // 否则抽屉标题已经是 B，图表还画着 A 的统计。
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === agentName ? previousData : undefined,
    refetchInterval: open && autoRefresh ? AUTO_REFRESH_MS : false,
  });

  const { refetch } = query;
  const refresh = useCallback(async () => {
    setManualRefreshing(true);
    try {
      await refetch();
    } finally {
      setManualRefreshing(false);
    }
  }, [refetch]);

  const data = query.data;
  const hasData = Boolean(data) && (data?.summary.total ?? 0) > 0;
  const firstLoading = query.isPending && !data;
  const refreshing = query.isFetching && Boolean(data);

  const title = useMemo(
    () => (
      <div className={styles.drawerTitle}>
        <div className={styles.titleMain}>
          <span className={styles.titleName}>
            {agent?.displayName || agentName || '智能体监控'}
          </span>
        </div>
        {agent?.displayName && agentName ? (
          <div className={styles.titleSub}>{agentName}</div>
        ) : null}
      </div>
    ),
    [agent, agentName]
  );

  const content = (() => {
    if (firstLoading) {
      return <Skeleton active paragraph={{ rows: 8 }} />;
    }
    if (query.isError && !data) {
      return (
        <Alert
          type="error"
          showIcon
          message="监控数据加载失败"
          description={query.error instanceof Error ? query.error.message : '请稍后重试'}
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        />
      );
    }
    if (!data) {
      return <EmptyBlock description="所选时间范围内暂无监控数据" />;
    }

    return (
      <>
        {query.isError ? (
          <Alert
            type="warning"
            showIcon
            message="刷新失败，当前展示的是上一次成功获取的数据"
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {data.truncated ? (
          <Alert
            type="warning"
            showIcon
            message="数据量过大，统计仅覆盖最新的一批运行"
            description="请缩短时间范围以获取完整统计。"
            style={{ marginBottom: 12 }}
          />
        ) : null}

        <div className={refreshing ? styles.refreshing : undefined}>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            destroyOnHidden
            items={[
              {
                key: 'overview',
                label: '运行概览',
                children: hasData ? (
                  <OverviewSection data={data} theme={theme} />
                ) : (
                  <EmptyBlock description="所选时间范围内暂无运行记录" />
                ),
              },
              {
                key: 'performance',
                label: '性能耗时',
                children: hasData ? (
                  <PerformanceSection data={data} theme={theme} />
                ) : (
                  <EmptyBlock description="所选时间范围内暂无可统计的耗时" />
                ),
              },
              {
                key: 'tokens',
                label: 'Token 用量',
                children: hasData ? (
                  <TokenSection data={data} theme={theme} />
                ) : (
                  <EmptyBlock description="所选时间范围内暂无 Token 用量" />
                ),
              },
              {
                key: 'runs',
                label: '运行记录与健康',
                children: <RunsHealthSection data={data} agent={agent} />,
              },
            ]}
          />
        </div>
      </>
    );
  })();

  return (
    <ResizableDrawer
      open={open}
      onClose={onClose}
      defaultWidth={1000}
      minWidth={640}
      storageKey="agents_monitor"
      destroyOnHidden
      title={title}
      styles={{ body: { padding: 0 } }}
    >
      <div className={styles.toolbar}>
        <Segmented
          size={isMobile ? 'small' : 'middle'}
          block={isMobile}
          options={MONITOR_RANGES.map(item => ({ label: item.label, value: item.key }))}
          value={range}
          onChange={value => setRange(value as MonitorRangeKey)}
        />
        <Space size={12} wrap className={styles.toolbarActions}>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={manualRefreshing}
            onClick={() => void refresh()}
          >
            刷新
          </Button>
          <span className={styles.autoRefresh}>
            <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
            自动刷新 30s
          </span>
          {data ? (
            <span className={styles.updated}>
              更新于 {formatDate(data.generatedAt, 'HH:mm:ss')}
            </span>
          ) : null}
        </Space>
      </div>

      <div className={styles.body}>{content}</div>
    </ResizableDrawer>
  );
}
