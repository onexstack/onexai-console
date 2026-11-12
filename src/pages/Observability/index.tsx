import { useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { Alert, Button, Empty, Result, Segmented, Select, Skeleton, Space, Switch } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useSessionToken } from '@/auth/tokenStore';
import { decodeClaims } from '@/auth/claims';
import { MONITOR_RANGES, type ChartTheme } from '@/components/metrics';
import { OptionLabel } from '@/components/OptionLabel';
import { matchOptionText } from '@/components/OptionLabel/helpers';
import { formatDate } from '@/lib/date';
import { useThemeState } from '@/runtime';
import { useIsMobile } from '@/ui';
import { ResourceShell } from '@/ui/components/ResourceShell';
import { OBSERVABILITY_VIEWS, parseRange, positiveInt, viewFromPathname } from './constants';
import { useAgentCatalog, useRunMonitor } from './queries';
import AgentsTab from './sections/AgentsTab';
import FailuresTab from './sections/FailuresTab';
import OverviewTab from './sections/OverviewTab';
import RunsTab from './sections/RunsTab';
import TokensTab from './sections/TokensTab';
import styles from './styles.module.scss';

/**
 * 观测中心。
 *
 * 5 个子页面是 5 条真实路由（侧栏叶子），页面内部不再渲染页签——左侧栏就是
 * 唯一的页面选择器。当前视图由 pathname 推导，`range/agent/refresh/page`
 * 保存在 query 里，刷新、深链、前进后退都成立。
 */
export default function ObservabilityPage() {
  const location = useLocation();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const theme = useThemeState().resolved as ChartTheme;

  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const isAdmin = Boolean(claims?.isAdmin);

  const view = viewFromPathname(location.pathname);
  const viewDef = OBSERVABILITY_VIEWS.find(item => item.key === view);
  const range = parseRange(params.get('range'));
  const agent = params.get('agent') ?? '';
  const autoRefresh = params.get('refresh') === '1';
  const page = positiveInt(params.get('page'), 1);

  const [refreshing, setRefreshing] = useState(false);

  const monitor = useRunMonitor({ range, agent, autoRefresh, enabled: isAdmin });
  const catalog = useAgentCatalog(isAdmin);
  const data = monitor.data;

  const agentOptions = useMemo(
    () =>
      catalog.agents.map(item => ({
        value: item.name,
        label: item.displayName || item.name,
        description: item.displayName ? item.name : undefined,
      })),
    [catalog.agents]
  );

  const update = (changes: Record<string, string | undefined>) => {
    setParams(
      previous => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined || value === '') next.delete(key);
          else next.set(key, value);
        }
        // 筛选变化就是新结果集，旧页码可能已经越界。
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace: true }
    );
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['observability'] });
    } finally {
      setRefreshing(false);
    }
  };

  if (!isAdmin) {
    return (
      <Result
        status="403"
        title="403"
        subTitle="观测中心仅管理员可见。"
        style={{ paddingTop: 96 }}
      />
    );
  }

  const toolbar = (
    <Space wrap>
      <Segmented
        size={isMobile ? 'small' : 'middle'}
        options={MONITOR_RANGES.map(item => ({ label: item.label, value: item.key }))}
        value={range}
        onChange={value => update({ range: String(value) })}
      />
      <Select
        allowClear
        showSearch
        placeholder="全部智能体"
        style={{ width: isMobile ? 160 : 200 }}
        popupMatchSelectWidth={320}
        value={agent || undefined}
        onChange={value => update({ agent: value })}
        options={agentOptions}
        optionRender={option => {
          const optionData = option.data as { description?: string };
          return <OptionLabel title={option.label} description={optionData.description} />;
        }}
        filterOption={(input, option) => matchOptionText(input, option?.label, option?.description)}
      />
      <Button
        size="small"
        icon={<ReloadOutlined />}
        loading={refreshing}
        onClick={() => void refresh()}
      >
        刷新
      </Button>
      <span className={styles.sectionNote}>
        <Switch
          size="small"
          checked={autoRefresh}
          onChange={checked => update({ refresh: checked ? '1' : undefined })}
        />{' '}
        自动刷新 30s
      </span>
      {data ? (
        <span className={styles.sectionNote}>
          更新于 {formatDate(data.generatedAt, 'HH:mm:ss')}
        </span>
      ) : null}
    </Space>
  );

  const alerts = (
    <>
      {monitor.isError ? (
        <Alert
          type="error"
          showIcon
          message="监控数据加载失败"
          description={monitor.error instanceof Error ? monitor.error.message : '请稍后重试'}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {data?.truncated ? (
        <Alert
          type="warning"
          showIcon
          message="数据量超过扫描上限，统计只覆盖最新样本"
          description={`本次聚合了最新 ${data.scannedRows.toLocaleString('zh-CN')} 行（上限 ${data.scanLimit.toLocaleString('zh-CN')}）。请缩短时间范围以获取完整统计。`}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {data?.agentsTruncated ? (
        <Alert
          type="warning"
          showIcon
          message="按智能体汇总已被截断"
          description="窗口内智能体数量超过 200 个，健康表只展示运行量最高的 200 个。"
          style={{ marginBottom: 12 }}
        />
      ) : null}
    </>
  );

  const section = (() => {
    if (view === 'failures') {
      return (
        <FailuresTab
          summary={data?.summary}
          agent={agent}
          range={range}
          page={page}
          autoRefresh={autoRefresh}
          onPageChange={next => update({ page: next > 1 ? String(next) : undefined })}
        />
      );
    }
    if (!data) {
      return <Skeleton active paragraph={{ rows: 8 }} />;
    }
    // 总览/运行/Token 依赖运行数据；空窗口直接给空态，避免一排全 0 的
    // 图表被误读成「平台完全没在跑」。
    if (data.summary.total === 0 && view !== 'agents') {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="所选时间范围内暂无运行记录，试试切换到 6 小时或 7 天。"
          style={{ padding: '48px 0' }}
        />
      );
    }
    switch (view) {
      case 'runs':
        return <RunsTab data={data} theme={theme} />;
      case 'tokens':
        return <TokensTab data={data} theme={theme} />;
      case 'agents':
        return <AgentsTab data={data} agents={catalog.agents} agentFilter={agent} />;
      default:
        return <OverviewTab data={data} theme={theme} />;
    }
  })();

  return (
    <ResourceShell
      title={t(viewDef?.label ?? '观测中心')}
      subtitle="观测中心 · 全局运行态势、耗时与 Token、智能体健康与异常。数据来自运行聚合，不是列表页的近似值。"
      toolbar={toolbar}
    >
      {alerts}
      {section}
    </ResourceShell>
  );
}
