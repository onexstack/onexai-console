import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Empty, Input, Skeleton, Tag } from 'antd';
import {
  ArrowRightOutlined,
  BugOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  RightOutlined,
  RobotOutlined,
  ScheduleOutlined,
  SearchOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';

import { getCommandCoverage, oncallGroupBinding, ticketApi } from '@/api/chat';
import { platformBinding } from '@/api/agent';
import { useSessionToken } from '@/auth/tokenStore';
import { decodeClaims } from '@/auth/claims';
import { dayjs, formatDate, getRelativeTime } from '@/lib/date';
import type { PlatformAgent, PlatformScheduledRun, Ticket } from '@/api/types';
import clsx from 'clsx';
import styles from './styles.module.scss';

/**
 * 工作台。
 *
 * 信息分三层，从上到下回答三个问题：
 * 1. 「我现在该做什么」—— 问候 + 一句话直达智能体，附常用提问；
 * 2. 「有没有火烧眉毛」—— 指标条，每个指标都能点进对应队列；
 * 3. 「具体是什么」—— 待处理工单、定时任务、智能体状态与快捷入口。
 *
 * 只聚合已有接口能回答的问题，不编造统计：工单数来自 `total`，值班组来自列表
 * 长度，智能体健康来自命令覆盖报告，定时任务来自 `lastScheduledAt`。任何一块
 * 失败都只把该块降级为空态/重试，不影响其它块。
 */

/** 提问建议：点击直接带着完整问题进入对话，省去打字。 */
const SUGGESTIONS = [
  {
    label: '今天有哪些待处理工单？',
    prompt: '今天有哪些待处理工单？请按级别排序，并给出建议的跟进顺序。',
  },
  {
    label: '最近一次定时任务失败了吗？',
    prompt: '检查最近一次定时任务的执行结果。如果有失败，说明原因和影响范围。',
  },
  {
    label: '本周谁在值班？',
    prompt: '本周的值班安排是什么？如果我要升级一个 P1 工单，应该找谁？',
  },
];

type StatTone = 'primary' | 'danger' | 'warning' | 'success' | 'neutral';

interface StatItem {
  key: string;
  label: string;
  value: number | undefined;
  hint: string;
  tone: StatTone;
  icon: ReactNode;
  to: string;
  /** 非零时把数值染成对应语义色（告警/待办不该被当成普通数字）。 */
  alert?: boolean;
}

const TONE_CLASS: Record<StatTone, string | undefined> = {
  primary: styles.tonePrimary,
  danger: styles.toneDanger,
  warning: styles.toneWarning,
  success: styles.toneSuccess,
  neutral: styles.toneNeutral,
};

/** 按当前时间给一句问候；小时取本地时区。 */
function greeting(): string {
  const hour = dayjs().hour();
  if (hour < 6) return '凌晨好';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/** 数字统一用中文千分位；还没拿到数据时显示 `—`，不显示 0 误导用户。 */
function countText(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString('zh-CN') : '—';
}

function RowsSkeleton() {
  return (
    <div className={styles.skeleton}>
      <Skeleton active title={false} paragraph={{ rows: 3 }} />
    </div>
  );
}

function CardEmpty({ text }: { text: string }) {
  return (
    <div className={styles.empty}>
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.stateNote}>
      无法读取（可能是权限或后端未启用）
      <button type="button" className={styles.retry} onClick={onRetry}>
        重试
      </button>
    </div>
  );
}

function CardHead({
  icon,
  tone,
  title,
  count,
  onMore,
}: {
  icon: ReactNode;
  tone: StatTone;
  title: string;
  count?: number;
  onMore?: () => void;
}) {
  return (
    <div className={styles.cardHead}>
      <span className={clsx(styles.cardIcon, TONE_CLASS[tone])}>{icon}</span>
      <span className={styles.cardTitle}>{title}</span>
      {typeof count === 'number' && <span className={styles.count}>{count}</span>}
      {onMore && (
        <button type="button" className={styles.more} onClick={onMore}>
          查看全部 <RightOutlined />
        </button>
      )}
    </div>
  );
}

export default function WorkbenchPage() {
  const navigate = useNavigate();
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  // 工单与命令覆盖在服务端要求管理员角色（chat 的 RequireAdmin）。非管理员不
  // 发这两个请求：请求必然 403，只会给工作台添两条失败记录。
  const isAdmin = Boolean(claims?.isAdmin);
  const [draft, setDraft] = useState('');

  const openTickets = useQuery({
    queryKey: ['chat', 'tickets', 'workbench', 'open'],
    queryFn: () => ticketApi.list({ page: 1, pageSize: 5, filters: { status: ['open'] } }),
    enabled: isAdmin,
    retry: false,
    meta: { silent: true },
  });
  const processingTickets = useQuery({
    queryKey: ['chat', 'tickets', 'workbench', 'processing'],
    queryFn: () => ticketApi.list({ page: 1, pageSize: 1, filters: { status: ['processing'] } }),
    enabled: isAdmin,
    retry: false,
    meta: { silent: true },
  });

  const oncall = useQuery({
    queryKey: ['res', 'oncall-groups', 'workbench'],
    queryFn: () => oncallGroupBinding.api.list({ page: 1, pageSize: 500 }),
    staleTime: 60_000,
  });

  const agents = useQuery({
    queryKey: ['res', 'agents', 'workbench'],
    queryFn: () => platformBinding('agents').api.list({ page: 1, pageSize: 100 }),
    staleTime: 60_000,
  });

  const coverage = useQuery({
    queryKey: ['chat', 'command-coverage'],
    queryFn: getCommandCoverage,
    enabled: isAdmin,
    staleTime: 60_000,
    retry: false,
  });

  const scheduled = useQuery({
    queryKey: ['res', 'scheduled-runs', 'workbench'],
    queryFn: () => platformBinding('scheduled-runs').api.list({ page: 1, pageSize: 5 }),
    staleTime: 60_000,
    retry: false,
  });

  const agentItems = (agents.data?.items ?? []) as PlatformAgent[];
  // 后端只在显式设置时输出 status；大量内建智能体的 status 是空字符串。
  // 空不等于停用，所以可用数按「不是 disabled」算。
  const disabledAgents = agentItems.filter(agent => agent.status === 'disabled').length;
  const availableAgents = agentItems.length - disabledAgents;
  const availablePercent =
    agentItems.length > 0 ? Math.round((availableAgents / agentItems.length) * 100) : 0;

  const scheduledItems = (scheduled.data?.items ?? []) as PlatformScheduledRun[];
  const openItems = (openTickets.data?.items ?? []) as (Ticket & Record<string, unknown>)[];
  const openTotal = openTickets.data?.total;

  const ask = () => {
    const text = draft.trim();
    navigate(text ? `/chat?draft=${encodeURIComponent(text)}` : '/chat');
  };

  const stats: StatItem[] = [
    ...(isAdmin
      ? [
          {
            key: 'open-tickets',
            label: '待处理工单',
            value: openTotal,
            hint: openTotal ? '需要尽快认领' : '队列已清空',
            tone: 'danger' as const,
            icon: <BugOutlined />,
            to: '/tickets',
            alert: true,
          },
          {
            key: 'processing-tickets',
            label: '处理中工单',
            value: processingTickets.data?.total,
            hint: '已有人跟进',
            tone: 'primary' as const,
            icon: <FieldTimeOutlined />,
            to: '/tickets',
          },
        ]
      : []),
    {
      key: 'agents',
      label: '可用智能体',
      value: agents.data ? availableAgents : undefined,
      hint: agents.data ? `共 ${agentItems.length} 个` : '读取中',
      tone: 'success' as const,
      icon: <RobotOutlined />,
      to: '/agents',
    },
    {
      key: 'oncall',
      label: '值班组',
      value: oncall.data?.total,
      hint: '排班与升级策略',
      tone: 'primary' as const,
      icon: <TeamOutlined />,
      to: '/oncall-groups',
    },
    {
      key: 'scheduled',
      label: '定时任务',
      value: scheduled.data?.total,
      hint: '周期自动执行',
      tone: 'neutral' as const,
      icon: <ScheduleOutlined />,
      to: '/scheduled-runs',
    },
    ...(isAdmin
      ? [
          {
            key: 'coverage',
            label: '命令覆盖告警',
            value: coverage.data?.withNothing,
            hint: coverage.data?.withNothing ? '覆盖缺失需排查' : '覆盖正常',
            tone: 'warning' as const,
            icon: <WarningOutlined />,
            to: '/command-coverage',
            alert: true,
          },
        ]
      : []),
  ];

  // 三张卡片先定义、后排版：管理员把工单放在主列，普通用户把智能体放到主列，
  // 两边都保持「主列内容多、侧列内容少」的平衡，避免整列留白。
  const ticketsCard = (
    <section className={styles.card}>
      <CardHead
        icon={<BugOutlined />}
        tone="danger"
        title="待处理工单"
        count={openTotal}
        onMore={() => navigate('/tickets')}
      />
      <div className={styles.cardBody}>
        {openTickets.isError ? (
          <LoadError onRetry={() => void openTickets.refetch()} />
        ) : openTickets.isLoading ? (
          <RowsSkeleton />
        ) : openItems.length === 0 ? (
          <CardEmpty text="没有待处理工单，队列已清空" />
        ) : (
          <div className={styles.rows}>
            {openItems.map(row => {
              const meta = [
                row.group_id,
                row.assignee_name
                  ? `@${row.assignee_name}`
                  : row.reporter_name
                    ? `由 ${row.reporter_name} 上报`
                    : undefined,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <button
                  key={row.ticket_id}
                  type="button"
                  className={styles.row}
                  onClick={() => navigate(`/tickets/${encodeURIComponent(String(row.ticket_id))}`)}
                >
                  <span className={styles.priority} data-level={row.level || 4}>
                    {row.level ? `P${row.level}` : '—'}
                  </span>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>
                      {row.title || row.description || row.ticket_id}
                    </span>
                    <span className={styles.rowMeta}>{meta || row.ticket_id}</span>
                  </span>
                  <span className={styles.rowTail}>
                    {row.updated_at ? getRelativeTime(row.updated_at) : '—'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  const scheduledCard = (
    <section className={styles.card}>
      <CardHead
        icon={<ClockCircleOutlined />}
        tone="primary"
        title="最近定时任务"
        onMore={() => navigate('/scheduled-runs')}
      />
      <div className={styles.cardBody}>
        {scheduled.isError ? (
          <LoadError onRetry={() => void scheduled.refetch()} />
        ) : scheduled.isLoading ? (
          <RowsSkeleton />
        ) : scheduledItems.length === 0 ? (
          <CardEmpty text="还没有定时任务" />
        ) : (
          <div className={styles.rows}>
            {scheduledItems.map(row => (
              <button
                key={row.name}
                type="button"
                className={styles.row}
                onClick={() => navigate(`/scheduled-runs/${encodeURIComponent(String(row.name))}`)}
              >
                <span className={clsx(styles.rowIcon, styles.tonePrimary)}>
                  <ScheduleOutlined />
                </span>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{String(row.displayName || row.name)}</span>
                  <span className={styles.rowMeta}>
                    {String(row.agent || '未绑定智能体')}
                    {row.schedule ? ` · ${String(row.schedule)}` : ''}
                  </span>
                </span>
                <span className={styles.rowTail}>
                  {row.paused ? (
                    <Tag bordered={false}>已暂停</Tag>
                  ) : row.nextScheduledAt ? (
                    `下次 ${formatDate(row.nextScheduledAt, 'MM-DD HH:mm')}`
                  ) : row.lastScheduledAt ? (
                    getRelativeTime(row.lastScheduledAt)
                  ) : (
                    '未运行'
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );

  const agentsCard = (
    <section className={styles.card}>
      <CardHead
        icon={<RobotOutlined />}
        tone="success"
        title="智能体"
        onMore={() => navigate('/agents')}
      />
      <div className={styles.cardBody}>
        {agents.isError ? (
          <LoadError onRetry={() => void agents.refetch()} />
        ) : agents.isLoading ? (
          <RowsSkeleton />
        ) : agentItems.length === 0 ? (
          <CardEmpty text="还没有智能体" />
        ) : (
          <>
            <div className={styles.agentSummary}>
              <span>
                可用 <strong>{availableAgents}</strong> / 共 {agentItems.length}
                {disabledAgents > 0 ? `（${disabledAgents} 个显式停用）` : ''}
              </span>
              <div className={styles.progress} aria-hidden>
                <span className={styles.progressFill} style={{ width: `${availablePercent}%` }} />
              </div>
            </div>
            <div className={styles.rows}>
              {agentItems.slice(0, 5).map(row => {
                const state =
                  row.status === 'disabled'
                    ? { dot: styles.dotOff, text: '停用' }
                    : row.status === 'enabled'
                      ? { dot: styles.dotOn, text: '启用' }
                      : { dot: styles.dotDefault, text: '默认' };
                // 展示名与资源名相同时，副行改放类型，避免两行重复；
                // 不放描述：内建智能体的描述是英文长句，在窄卡里只会被截断。
                const display = row.displayName || row.name;
                const meta =
                  display !== row.name
                    ? row.name
                    : row.kind === 'external'
                      ? '外部智能体'
                      : '平台智能体';
                return (
                  <button
                    key={row.name}
                    type="button"
                    className={styles.row}
                    onClick={() => navigate(`/agents/${encodeURIComponent(String(row.name))}`)}
                  >
                    <span className={clsx(styles.dot, state.dot)} />
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>{String(display)}</span>
                      <span className={styles.rowMeta}>{String(meta)}</span>
                    </span>
                    <span className={styles.rowTail}>
                      {row.kind === 'external' && <Tag bordered={false}>外部</Tag>}
                      {state.text}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );

  return (
    <div className={styles.page}>
      {/* ── 问候与提问 ─────────────────────────────────────────────────── */}
      <header className={styles.hero}>
        <div className={styles.heroMain}>
          <p className={styles.eyebrow}>{dayjs().format('YYYY年M月D日 dddd')}</p>
          <h1 className={styles.title}>
            {greeting()}，{claims?.name ?? '同事'}
          </h1>
          <p className={styles.subtitle}>
            从待办、值班和智能体状态开始今天的工作，或者直接向智能体提问。
          </p>

          <div className={styles.askRow}>
            <Input
              size="large"
              className={styles.askInput}
              prefix={<SearchOutlined className={styles.askIcon} />}
              placeholder="问智能体：今天有哪些待处理工单？"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onPressEnter={ask}
              allowClear
            />
            <button type="button" className={styles.askButton} onClick={ask}>
              去问 <ArrowRightOutlined />
            </button>
          </div>

          <div className={styles.chips}>
            <span className={styles.chipsLabel}>试试</span>
            {SUGGESTIONS.map(item => (
              <button
                key={item.label}
                type="button"
                className={styles.chip}
                onClick={() => navigate(`/chat?draft=${encodeURIComponent(item.prompt)}`)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.heroSide}>
          <Tag color={claims?.isAdmin ? 'blue' : 'default'} bordered={false}>
            {claims?.isAdmin ? '管理员' : '普通用户'}
          </Tag>
          <Tag bordered={false}>{claims?.provider ?? 'onexai'}</Tag>
        </div>
      </header>

      {/* ── 指标条 ─────────────────────────────────────────────────────── */}
      <section className={styles.stats} aria-label="关键指标">
        {stats.map(item => (
          <button
            key={item.key}
            type="button"
            className={styles.stat}
            data-alert={item.alert && (item.value ?? 0) > 0 ? item.tone : undefined}
            onClick={() => navigate(item.to)}
          >
            <span className={clsx(styles.statIcon, TONE_CLASS[item.tone])}>{item.icon}</span>
            <span className={styles.statBody}>
              <span className={styles.statLabel}>{item.label}</span>
              <span className={styles.statValue}>{countText(item.value)}</span>
              <span className={styles.statHint}>{item.hint}</span>
            </span>
            <ArrowRightOutlined className={styles.statArrow} />
          </button>
        ))}
      </section>

      {/* ── 主体：左列表、右概览 ───────────────────────────────────────── */}
      <div className={styles.main}>
        <div className={styles.column}>
          {isAdmin && ticketsCard}
          {isAdmin ? scheduledCard : agentsCard}
        </div>

        <div className={styles.column}>{isAdmin ? agentsCard : scheduledCard}</div>
      </div>
    </div>
  );
}
