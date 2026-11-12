import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { App, Button, Popconfirm, Segmented, Space, Tag, Tooltip } from 'antd';
import {
  BarChartOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';

import {
  ColumnSettingsModal,
  EllipsisText,
  RESOURCE_ACTION_COLUMN,
  RESOURCE_ID_COLUMN_WIDTH,
  RESOURCE_ID_TEXT_MAX_WIDTH,
  RESOURCE_TABLE_LAYOUT,
  RESOURCE_TIME_COLUMN_WIDTH,
  ResourceNameCell,
  ResponsiveTable,
  SearchTagInput,
  mergeColumnOrder,
} from '@/ui';
import type { ColItem, ColumnLayout, MobileColumn, SearchTag } from '@/ui';
import { ResourceCard, ResourceShell } from '@/ui/components/ResourceShell';
import { ListPagination } from '@/ui/components/Pagination';
import { useLinkHandler, useNamespace } from '@/runtime';
import { useIsMobile } from '@/ui/responsive';
import NamespaceSelect from '@/components/NamespaceSelect';
import { RESOURCE_BY_KEY } from '@/api/resources';
import { fetchAllRows, resourceRowsQueryKey } from '@/api/resourceDefs';
import type { PlatformAgent } from '@/api/types';
import { downloadCsv } from '@/lib/csv';
import { formatDate } from '@/lib/date';
import { sortNewestFirst } from '@/lib/list-order';
import MonitorDrawer from '@/components/AgentMonitorDrawer';
import styles from './styles.module.scss';
import {
  AGENT_KIND_META,
  agentKind,
  executionModeOf,
  stateOf,
  versionOrModel,
} from '@/components/agents/meta';

// 场景智能体前端支持暂时隐藏：只保留全部 / 平台 / A2A 三个页签。
type TabKey = 'all' | 'native' | 'external';

const TABS: { label: string; value: TabKey }[] = [
  { label: '全部', value: 'all' },
  { label: '平台智能体', value: 'native' },
  { label: 'A2A 智能体', value: 'external' },
];

/**
 * 新建入口的预选类型：只有 A2A 页签预选外部注册，其余（含「全部」）都从
 * 平台智能体开始。
 */
const createPathOf = (tab: TabKey) =>
  tab === 'external' ? '/agents/new?type=external' : '/agents/new?type=native';

/**
 * 搜索栏可选的字段。
 *
 * 与列表里能解释的属性一一对应：搜索栏是「按字段精确过滤」，不是隐式跨字段
 * 模糊匹配 —— 后者无法告诉用户「为什么这一行没出来」。
 */
const SEARCH_FIELDS = [
  { key: 'name', label: '名称' },
  { key: 'displayName', label: '显示名' },
  { key: 'description', label: '描述' },
  { key: 'model', label: '模型' },
  { key: 'skillNames', label: '技能' },
];
const DEFAULT_SEARCH_FIELD = SEARCH_FIELDS[0];

/**
 * 智能体详情页地址。列表主标识与「编辑」链接都由它派生，避免两处编码方式漂移。
 */
const detailPathOf = (agent: PlatformAgent) => `/agents/${encodeURIComponent(agent.name)}`;

/**
 * 监控抽屉地址。抽屉本身就由 URL 参数驱动，给它一个真 href 才能被中键/⌘ 点击开进新标签。
 * 带上当前页签，避免在「平台/A2A」页签里打开监控时把筛选重置成「全部」。
 */
const monitorPath = (name: string, tab: TabKey) => {
  const next = new URLSearchParams();
  if (tab !== 'all') next.set('tab', tab);
  next.set('monitor', name);
  return `/agents?${next.toString()}`;
};

interface ExportColumn {
  title: string;
  value: (agent: PlatformAgent) => string;
}

/**
 * 导出列：与当前页签的表格列一一对应，但写的是**原始值**。
 *
 * 表格单元格里是 Tag、链接、带 tooltip 的截断文本，直接 `String()` 单元格会导出
 * `[object Object]`；所以导出不看 `render`，用与单元格同一份 `stateOf` / `executionModeOf`
 * 派生函数取文本，保证导出的说法与屏幕上一致。
 */
function exportColumnsOf(tab: TabKey): ExportColumn[] {
  return [
    { title: '名称', value: agent => agent.name },
    { title: '显示名', value: agent => agent.displayName ?? '' },
    { title: '类型', value: agent => AGENT_KIND_META[agentKind(agent)].text },
    { title: '状态', value: agent => stateOf(agent).text },
    { title: '执行方式', value: agent => executionModeOf(agent).text },
    {
      title: tab === 'external' ? '版本' : '版本/模型',
      value: agent => versionOrModel(agent),
    },
    ...(tab === 'external'
      ? ([
          {
            title: '注册来源',
            value: (agent: PlatformAgent) => agent.execution?.a2a?.source ?? agent.source ?? '',
          },
          {
            title: '协议',
            value: (agent: PlatformAgent) =>
              agent.a2a?.protocolVersion ?? agent.protocolVersion ?? '',
          },
          {
            title: '服务地址',
            value: (agent: PlatformAgent) => agent.a2a?.resolvedEndpoint ?? agent.endpoint ?? '',
          },
          {
            title: '技能',
            value: (agent: PlatformAgent) =>
              (agent.a2a?.skills?.map(skill => skill.name) ?? agent.skillNames ?? []).join('、'),
          },
        ] as ExportColumn[])
      : []),
    { title: '命名空间', value: agent => agent.namespace ?? '' },
    { title: '创建时间', value: agent => (agent.createdAt ? formatDate(agent.createdAt) : '') },
    { title: '更新时间', value: agent => (agent.updatedAt ? formatDate(agent.updatedAt) : '') },
  ];
}

export default function AgentsPage() {
  const navigate = useNavigate();
  const link = useLinkHandler();
  const namespace = useNamespace();
  const isMobile = useIsMobile();
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();
  // 只认三个合法值：URL 被手改成 `?tab=foo` 时退回「全部」，而不是筛出一张空表
  // ——空表无法解释自己，用户只会以为数据没了。
  const rawTab = params.get('tab');
  const tab: TabKey = rawTab === 'native' || rawTab === 'external' ? rawTab : 'all';
  // 监控抽屉由 URL 驱动：刷新、分享、从详情页返回都能恢复同一条智能体的监控。
  // 关闭动画期间 URL 已经清空，保留最后一个名字让标题不闪。
  const monitorName = params.get('monitor')?.trim() ?? '';
  const [lastMonitorName, setLastMonitorName] = useState('');
  const [searchTags, setSearchTags] = useState<SearchTag[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // ── 列设置（与 `ResourcePage` 同一套行为：排序 + 显隐 + 行密度，不跨会话持久化） ──
  const [colOrder, setColOrder] = useState<string[]>([]);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [layout, setLayout] = useState<ColumnLayout>('loose');
  const [colSettingsOpen, setColSettingsOpen] = useState(false);

  // 业务空间是跨页面的全局筛选，变化后结果集可能只剩一两页；停在第 4 页会看到
  // 一张空表而分页条还写着 4。切空间一律回到第 1 页。
  useEffect(() => {
    setPage(1);
  }, [namespace]);

  useEffect(() => {
    if (monitorName) setLastMonitorName(monitorName);
  }, [monitorName]);

  const openMonitor = useCallback(
    (name: string) => {
      setParams(
        previous => {
          const next = new URLSearchParams(previous);
          next.set('monitor', name);
          return next;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  const closeMonitor = useCallback(() => {
    setParams(
      previous => {
        const next = new URLSearchParams(previous);
        next.delete('monitor');
        return next;
      },
      { replace: true }
    );
  }, [setParams]);

  // 直接观察全量行缓存；`queryFn` 不能用 `listAllRows`（它自己 fetch 同一个键，
  // 外层等待内层返回的正是外层的 promise，页面会永远停在 loading）。见
  // `resourceRowsQueryKey` 的注释。
  const {
    data = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: resourceRowsQueryKey('agents'),
    queryFn: () => fetchAllRows('agents'),
    staleTime: 15_000,
  });

  const agents = useMemo(() => {
    const rows = (data as unknown as PlatformAgent[]).filter(agent => {
      if (namespace && agent.namespace !== namespace) return false;
      if (tab !== 'all' && agentKind(agent) !== tab) return false;
      // 与 `ResourcePage` 的标签匹配同一口径：逐字段 `includes`。`skillNames`
      // 是数组，`String()` 后是逗号串，仍然可匹配单个技能名。
      return searchTags.every(tag =>
        String((agent as unknown as Record<string, unknown>)[tag.fieldKey] ?? '')
          .toLowerCase()
          .includes(tag.value.toLowerCase())
      );
    });
    // 与其他资源列表同一口径：创建时间倒序，ID/名称倒序兜底。
    return sortNewestFirst(rows, 'name');
  }, [data, namespace, tab, searchTags]);

  const handleSearchTagsChange = useCallback((tags: SearchTag[]) => {
    setSearchTags(tags);
    setPage(1);
  }, []);

  const paged = useMemo(
    () => agents.slice((page - 1) * pageSize, page * pageSize),
    [agents, page, pageSize]
  );

  // 健康信息取全量缓存而不是当前筛选结果：切到「A2A 智能体」页签时，深链里
  // 的平台智能体仍应能补齐标题与健康卡。
  const monitoredAgent = useMemo(
    () => (data as unknown as PlatformAgent[]).find(agent => agent.name === monitorName),
    [data, monitorName]
  );

  const open = useCallback(
    (agent: PlatformAgent, event: React.MouseEvent) => {
      void link(detailPathOf(agent), event);
    },
    [link]
  );

  /**
   * 列表内改名。
   *
   * 与通用列表同一条写通路：`saveOne` 会读整行合并后 PUT，并修补
   * `['res','agents','all']` 缓存；这里不额外重取，避免 informer 还没追上时
   * 把刚改好的值打回旧值。
   */
  const renameAgent = useCallback(
    async (name: string, next: string) => {
      const update = RESOURCE_BY_KEY.agents?.binding.api.update;
      if (!update) throw new Error('当前资源不支持修改');
      try {
        await update(name, { displayName: next.trim() });
      } catch (err) {
        message.error(err instanceof Error ? err.message : '修改失败');
        throw err;
      }
      message.success('修改成功');
    },
    [message]
  );

  /**
   * 列表内删除。
   *
   * 与通用列表同一条写通路：`removeOne` 发 `DELETE /v1/agent/agents/:name`，
   * 成功后失效 `['res','agents']`，本页 `useQuery(resourceRowsQueryKey('agents'))`
   * 会自动重取，不需要手动 refetch。
   */
  const removeAgent = useCallback(
    async (agent: PlatformAgent) => {
      const remove = RESOURCE_BY_KEY.agents?.binding.api.remove;
      if (!remove) return;
      try {
        await remove(agent.name);
        message.success('删除成功');
        // 正在看的监控抽屉指向已删除的对象：直接关掉，避免抽屉留在空数据上。
        if (monitorName === agent.name) closeMonitor();
        // 删掉当前页最后一行时退回上一页，而不是停在一张空表上。
        if (paged.length === 1 && page > 1) setPage(page - 1);
      } catch (err) {
        message.error(err instanceof Error ? err.message : '删除失败');
      }
    },
    [message, monitorName, closeMonitor, paged.length, page]
  );

  const columns = useMemo<MobileColumn<PlatformAgent>[]>(
    () => [
      {
        title: '名称/ID',
        key: 'name',
        // auto 布局下 width 只是偏好宽度：给 ID/名称列留足空间，内容更宽时照常撑开。
        width: RESOURCE_ID_COLUMN_WIDTH,
        render: (_, agent) => (
          <ResourceNameCell
            id={agent.name}
            idNode={
              <EllipsisText maxWidth={RESOURCE_ID_TEXT_MAX_WIDTH} title={agent.name}>
                <a
                  href={detailPathOf(agent)}
                  onClick={event => {
                    event.preventDefault();
                    open(agent, event);
                  }}
                >
                  {agent.name}
                </a>
              </EllipsisText>
            }
            name={agent.displayName ?? ''}
            onRename={next => renameAgent(agent.name, next)}
          />
        ),
      },
      {
        // 紧跟名称列：监控是「这一行是谁、它现在怎么样」的补充信息，紧挨主标识
        // 才有意义；放到表格右缘会让人先扫完一整行元数据才找到它。
        title: '监控',
        key: 'monitor',
        width: 56,
        align: 'center',
        // 移动端卡片不放孤零零一个图标；监控入口改由操作列里的「监控」文字链接承担。
        mobileHidden: true,
        render: (_, agent) => (
          <Tooltip title="监控">
            <Button
              // text 而不是 link：图标用正常文字色，不再整列泛蓝。
              type="text"
              size="small"
              aria-label={`查看 ${agent.displayName || agent.name} 的监控`}
              icon={<BarChartOutlined />}
              onClick={event => {
                event.stopPropagation();
                openMonitor(agent.name);
              }}
            />
          </Tooltip>
        ),
      },
      {
        title: '类型',
        key: 'kind',
        width: 72,
        mobilePriority: 10,
        // 只描述「在哪定义」；「在哪执行」交给下一列的执行方式 —— 同一个 A2A 信息
        // 不再在一行里出现两次（旧版在 native + a2a 时额外拼一个「A2A 运行时」）。
        render: (_, agent) => {
          const meta = AGENT_KIND_META[agentKind(agent)];
          return <Tag color={meta.color}>{meta.text}</Tag>;
        },
      },
      ...(tab === 'external'
        ? ([
            {
              title: '注册来源',
              key: 'source',
              render: (_, agent) => agent.execution?.a2a?.source ?? agent.source ?? '-',
            },
            {
              title: '协议',
              key: 'protocol',
              width: 88,
              render: (_, agent) => {
                const version = agent.a2a?.protocolVersion ?? agent.protocolVersion;
                if (!version) return '-';
                return (
                  <Tooltip title={agent.a2a?.transport ?? agent.transport ?? ''}>
                    <Tag>{version}</Tag>
                  </Tooltip>
                );
              },
            },
          ] as MobileColumn<PlatformAgent>[])
        : []),
      {
        title: '状态',
        key: 'state',
        width: 80,
        mobilePriority: 30,
        render: (_, agent) => {
          const state = stateOf(agent);
          const message = agent.a2a?.lastSyncError;
          return (
            <Tooltip title={message}>
              <Tag color={state.color}>{state.text}</Tag>
            </Tooltip>
          );
        },
      },
      {
        title: '执行方式',
        key: 'execution',
        width: 88,
        mobilePriority: 20,
        render: (_, agent) => {
          // 文案与颜色只在 `executionModeOf` 定义一次：详情页、抽屉与本列共用。
          const execution = executionModeOf(agent);
          return (
            <Tooltip title={execution.tooltip}>
              <Tag color={execution.color}>{execution.text}</Tag>
            </Tooltip>
          );
        },
      },
      {
        title: tab === 'external' ? '版本' : '版本/模型',
        key: 'version',
        render: (_, agent) => versionOrModel(agent),
      },
      ...(tab === 'external'
        ? ([
            {
              title: '服务地址',
              key: 'endpoint',
              render: (_, agent) => {
                const endpoint = agent.a2a?.resolvedEndpoint ?? agent.endpoint;
                if (!endpoint) return '-';
                // 自动列宽下列上的 width 拦不住长 URL，必须在单元格内部限宽，
                // 否则一条地址能把整张表撑到上千 px。
                return (
                  <EllipsisText maxWidth={320} title={endpoint}>
                    {endpoint}
                  </EllipsisText>
                );
              },
            },
            {
              title: '技能',
              key: 'skills',
              render: (_, agent) => {
                const names = agent.a2a?.skills?.map(skill => skill.name) ?? agent.skillNames ?? [];
                if (names.length === 0) return '-';
                return (
                  <Tooltip title={names.join('、')}>
                    <span>{names.length} 项</span>
                  </Tooltip>
                );
              },
            },
          ] as MobileColumn<PlatformAgent>[])
        : []),
      {
        title: '命名空间',
        key: 'namespace',
        render: (_, agent) => agent.namespace ?? '-',
      },
      {
        title: '创建时间',
        key: 'createdAt',
        width: RESOURCE_TIME_COLUMN_WIDTH,
        render: (_, agent) => (
          <span style={{ whiteSpace: 'nowrap' }}>
            {agent.createdAt ? formatDate(agent.createdAt) : '-'}
          </span>
        ),
      },
      {
        title: '更新时间',
        key: 'updatedAt',
        // 与创建时间同宽、紧邻其右：两个时间列纵向对齐，扫一眼就能比较先后。
        width: RESOURCE_TIME_COLUMN_WIDTH,
        render: (_, agent) => (
          <span style={{ whiteSpace: 'nowrap' }}>
            {agent.updatedAt ? formatDate(agent.updatedAt) : '-'}
          </span>
        ),
      },
      {
        title: '操作',
        key: 'actions',
        // 操作列永远吸附在内容区右缘；表格超宽时在卡片内部横向滚动，它不移动。
        ...RESOURCE_ACTION_COLUMN,
        render: (_, agent) => {
          const chat = `/chat?agent=${encodeURIComponent(agent.name)}`;
          // 移动端监控列隐藏，操作列补一个文字入口；桌面端仍只走图标列，不重复。
          const monitor = isMobile ? monitorPath(agent.name, tab) : '';
          // 详情由名称列的主标识承担；操作列只留高频的编辑 / 对话 / 删除。
          const label = agent.displayName || agent.name;

          return (
            <Space size={4}>
              <a
                href={`${detailPathOf(agent)}/edit`}
                onClick={event => {
                  event.preventDefault();
                  void link(`${detailPathOf(agent)}/edit`, event);
                }}
              >
                编辑
              </a>
              {/* 两种类型都能直接在 Chat 里对话（A2A 由对端执行）。 */}
              <a
                href={chat}
                onClick={event => {
                  event.preventDefault();
                  void link(chat, event);
                }}
              >
                对话
              </a>
              {isMobile && (
                <a
                  href={monitor}
                  onClick={event => {
                    event.preventDefault();
                    // 抽屉由 URL 参数驱动，普通点击与图标列一致；⌘/Ctrl/中键由
                    // `useLinkHandler` 开新标签。
                    void link(monitor, event);
                  }}
                >
                  监控
                </a>
              )}
              <Popconfirm
                title={`确定删除智能体 ${label} 吗？`}
                description="删除后无法恢复。"
                okText="确定"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => removeAgent(agent)}
              >
                <span className={styles.actionDangerLink}>删除</span>
              </Popconfirm>
            </Space>
          );
        },
      },
    ],
    [tab, open, renameAgent, removeAgent, openMonitor, link, isMobile]
  );

  // ── 列设置：顺序 / 显隐 / 行密度（与 `ResourcePage` 同一套行为） ──
  //
  // 可拖动列 = 除「名称/ID」与「操作」之外的列；列集合随页签变化（A2A 页签多出
  // 注册来源、协议、服务地址、技能），所以顺序按 key 对齐：用户排好的键保持原位，
  // 新出现的键按默认顺序补在末尾，而不是切一次页签就重置。
  const draggableKeys = useMemo(
    () =>
      columns
        .filter(column => column.key !== 'name' && column.key !== 'actions')
        .map(column => String(column.key)),
    [columns]
  );

  const orderedColumns = useMemo(() => {
    const byKey = Object.fromEntries(columns.map(column => [String(column.key), column]));
    const middle = mergeColumnOrder(colOrder, draggableKeys)
      .filter(key => !hiddenKeys.includes(key))
      .map(key => byKey[key])
      .filter((column): column is MobileColumn<PlatformAgent> => Boolean(column));
    return [byKey.name, ...middle, byKey.actions].filter(
      (column): column is MobileColumn<PlatformAgent> => Boolean(column)
    );
  }, [columns, colOrder, hiddenKeys, draggableKeys]);

  const colSettingsItems = useMemo<ColItem[]>(() => {
    const byKey = Object.fromEntries(columns.map(column => [String(column.key), column]));
    return [
      { key: 'name', title: '名称/ID', visible: true, fixed: true },
      ...mergeColumnOrder(colOrder, draggableKeys).map(key => ({
        key,
        title: String(byKey[key]?.title ?? key),
        visible: !hiddenKeys.includes(key),
      })),
    ];
  }, [columns, colOrder, hiddenKeys, draggableKeys]);

  const applyColSettings = useCallback((nextLayout: ColumnLayout, items: ColItem[]) => {
    // 第一项是固定的 ID/名称列，不参与顺序与显隐。
    const draggable = items.slice(1);
    setLayout(nextLayout);
    setColOrder(draggable.map(item => item.key));
    setHiddenKeys(draggable.filter(item => !item.visible).map(item => item.key));
    setColSettingsOpen(false);
  }, []);

  const handleDownload = useCallback(() => {
    const cols = exportColumnsOf(tab);
    // 分页在本地完成，导出的应是**筛选后的完整结果**，而不是当前这一页 —— 否则
    // 停在第 2 页点「导出」，导出的内容是第 1 页的重复。
    downloadCsv(
      `智能体-${Date.now()}.csv`,
      cols.map(column => column.title),
      agents.map(agent => cols.map(column => column.value(agent)))
    );
    message.success('导出成功');
  }, [tab, agents, message]);

  return (
    <ResourceShell title="智能体" titleExtra={<NamespaceSelect />}>
      {/* ── Row 1: 主操作在左、页签在右（与 ResourcePage 的工具栏同规格） ── */}
      <div className={styles.toolbar}>
        <Button
          type="primary"
          // 一个入口、一个页面：A2A 页签预选外部类型，其余（含「全部」）都预选
          // 平台智能体。两种类型共用 `/agents/new` 的完整表单。
          onClick={() => navigate(createPathOf(tab))}
        >
          新建
        </Button>
        <Segmented
          options={TABS}
          value={tab}
          onChange={value => {
            const next = new URLSearchParams(params);
            if (value === 'all') next.delete('tab');
            else next.set('tab', String(value));
            setParams(next, { replace: true });
            setPage(1);
          }}
        />
      </div>

      {/* ── Row 2: 整行标准搜索栏 + 刷新 / 导出 / 设置（与其他列表页同规格） ── */}
      <div className={styles.searchRow}>
        <SearchTagInput
          tags={searchTags}
          fields={SEARCH_FIELDS}
          defaultField={DEFAULT_SEARCH_FIELD}
          onTagsChange={handleSearchTagsChange}
        />
        <Tooltip title="刷新">
          <Button
            icon={<ReloadOutlined />}
            loading={isFetching}
            aria-label="刷新智能体列表"
            onClick={() => void refetch()}
          />
        </Tooltip>
        <Tooltip title="导出">
          <Button
            icon={<DownloadOutlined />}
            aria-label="导出智能体列表"
            onClick={handleDownload}
          />
        </Tooltip>
        <Tooltip title="设置列表字段">
          <Button
            icon={<SettingOutlined />}
            aria-label="设置列表字段"
            onClick={() => setColSettingsOpen(true)}
          />
        </Tooltip>
      </div>

      <ResourceCard loose={layout === 'loose'}>
        <ResponsiveTable<PlatformAgent>
          rowKey="name"
          loading={isLoading}
          columns={orderedColumns}
          dataSource={paged}
          pagination={false}
          size={layout === 'compact' ? 'small' : 'middle'}
          idKey="name"
          nameField="displayName"
          emptyText="暂无智能体"
          // 整表铺满卡片、列宽按内容分配，操作列吸附卡片右缘；内容超宽时在表格
          // 内部横向滚动。见 `RESOURCE_TABLE_LAYOUT`。
          {...RESOURCE_TABLE_LAYOUT}
          // 卡片是滚动容器：长列表滚动时表头吸顶，与 ResourcePage 同一组合。
          sticky
        />
      </ResourceCard>
      <ListPagination
        total={agents.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={size => {
          setPageSize(size);
          setPage(1);
        }}
        hideOnSinglePage={false}
      />
      <MonitorDrawer
        open={Boolean(monitorName)}
        agentName={monitorName || lastMonitorName}
        agent={monitoredAgent}
        onClose={closeMonitor}
      />
      <ColumnSettingsModal
        open={colSettingsOpen}
        layout={layout}
        items={colSettingsItems}
        onOk={applyColSettings}
        onCancel={() => setColSettingsOpen(false)}
      />
    </ResourceShell>
  );
}
