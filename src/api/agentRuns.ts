import { agentClient, request } from './client';
import { AGENT } from './endpoints';

/**
 * 异步任务（agent run）管理面。
 *
 * 这些接口挂在 `/v1/admin/agent/runs`：控制台的运行时令牌是管理员 bearer，
 * 而服务端真正的异步调度接口 `/v1/agent/runs` 走 AK/SK 签名，浏览器不可用。
 * 列表以 run_admission 为主表，因此排队中的任务（还没有 session/run 行）也会
 * 出现在这里；详情只在任务确实开始后才带事件。
 */

export type AdminRunState = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | string;

export type AdminRunTrigger = 'scheduled' | 'manual' | 'retry' | 'unknown' | string;

export interface AdminRun {
  id: string;
  sessionId?: string;
  agent?: string;
  subject?: string;
  source?: string;
  scheduleRef?: string;
  trigger?: AdminRunTrigger;
  state: AdminRunState;
  error?: string;
  attempt?: number;
  startedAt?: number;
  finishedAt?: number;
  createdAt?: number;
  promptPreview?: string;
}

export interface AdminRunDetail extends AdminRun {
  /** run 表的原始状态，仅供排障；列表/详情的主状态是 admission 状态。 */
  runState?: string;
  prompt?: string;
  usageJson?: string;
  taskJson?: string;
  actor?: string;
  runtime?: string;
  requestId?: string;
  requestJson?: string;
  metadata?: Record<string, string>;
}

export interface AdminAdmission {
  state?: string;
  message?: string;
  claimCount?: number;
  createdAt?: number;
}

export interface AdminRunEvent {
  seq: number;
  type: string;
  payload: string;
  createdAt: number;
}

export interface AdminRunQuery {
  offset?: number;
  limit?: number;
  state?: string;
  agent?: string;
  trigger?: string;
  source?: string;
  keyword?: string;
  /** Unix 毫秒，按 admission 创建时间的半开窗口；必须成对出现。 */
  from?: number;
  to?: number;
}

export interface AdminRunPage {
  runs: AdminRun[];
  count: number;
}

export interface AdminRunDetailResponse {
  run: AdminRunDetail;
  admission: AdminAdmission;
}

export interface AdminRunEventsResponse {
  events: AdminRunEvent[];
}

export const ADMIN_RUN_STATE: Record<string, { text: string; color: string }> = {
  pending: { text: '等待中', color: 'default' },
  running: { text: '运行中', color: 'blue' },
  succeeded: { text: '成功', color: 'green' },
  failed: { text: '失败', color: 'red' },
  canceled: { text: '已取消', color: 'default' },
};

export const ADMIN_RUN_TRIGGER: Record<string, string> = {
  scheduled: '定时',
  manual: '手动',
  retry: '重试',
  unknown: '未知',
};

export function adminRunStateMeta(state: string | undefined): { text: string; color: string } {
  return ADMIN_RUN_STATE[state ?? ''] ?? { text: state || '-', color: 'default' };
}

export function isAdminRunActive(state: string | undefined): boolean {
  return state === 'pending' || state === 'running';
}

export function isAdminRunRetryable(state: string | undefined): boolean {
  return state === 'failed' || state === 'canceled';
}

/** 列表：服务端 offset/limit 分页，最新在前。 */
export function listAgentRuns(query: AdminRunQuery): Promise<AdminRunPage> {
  return request<AdminRunPage>(agentClient, {
    url: AGENT.adminRuns,
    method: 'GET',
    params: query,
  });
}

/** 详情：任务、admission 与请求上下文。 */
export function getAgentRun(id: string): Promise<AdminRunDetailResponse> {
  return request<AdminRunDetailResponse>(agentClient, {
    url: AGENT.adminRun(id),
    method: 'GET',
  });
}

/** 事件：按 seq 游标增量读取；pending 任务返回空数组。 */
export function listAgentRunEvents(
  id: string,
  options: { after?: number; limit?: number } = {}
): Promise<AdminRunEvent[]> {
  return request<AdminRunEventsResponse>(agentClient, {
    url: AGENT.adminRunEvents(id),
    method: 'GET',
    params: { after: options.after, limit: options.limit },
  }).then(response => response.events ?? []);
}

/** 取消：pending/running 有效，终态幂等返回成功。 */
export async function cancelAgentRun(id: string): Promise<void> {
  await request<void>(agentClient, {
    url: AGENT.adminRunCancel(id),
    method: 'POST',
  });
}

/** 重试：只允许 failed/canceled，返回新任务。 */
export function retryAgentRun(
  id: string
): Promise<{ id: string; sessionID: string; state: string }> {
  return request<{ id: string; sessionID: string; state: string }>(agentClient, {
    url: AGENT.adminRunRetry(id),
    method: 'POST',
  });
}

/** 卡住原因：排队超时 / 租约过期 / 运行超时。 */
export type StuckRunReason = 'pending_timeout' | 'lease_expired' | 'running_timeout' | string;

export interface StuckRun {
  id: string;
  agent: string;
  state: string;
  /** admission（异步任务）或 run（交互式运行）。 */
  source: string;
  createdAt: number;
  startedAt: number;
  scheduledAt: number;
  leaseUntil: number;
  reason: StuckRunReason;
}

export interface StuckRunThresholds {
  pendingMs: number;
  runningMs: number;
}

export interface StuckRunsResponse {
  generatedAt: number;
  thresholds: StuckRunThresholds;
  items: StuckRun[];
}

/**
 * 卡住运行：由服务端按 lease / scheduled_time / 运行时长判定。
 *
 * 前端不要在本地按 createdAt 猜——未来排期的 pending 与 lease 仍有效的
 * running 都会被误报，交互式运行也根本不在 admission 列表里。
 */
export function getStuckRuns(
  query: { agent?: string; limit?: number } = {}
): Promise<StuckRunsResponse> {
  return request<StuckRunsResponse>(agentClient, {
    url: AGENT.adminRunStuck,
    method: 'GET',
    params: query,
  });
}
