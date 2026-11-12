import { agentClient, request } from './client';
import { AGENT } from './endpoints';

/**
 * 运行监控聚合（单个智能体或全平台）。
 *
 * 后端的统计窗口是半开区间 `[from, to)`：admission 按创建时间归属，没有
 * admission 的交互式运行按 started_at 归属；耗时与 token 来自已关联的 run 行。
 * 列表接口不含这些聚合，监控抽屉与观测中心都必须走这个接口，而不是在前端对
 * 最近几百条运行记录做近似统计。
 *
 * 全平台必须显式传 `all: true`；漏传 agent 不是「全量」而是 400，避免一次
 * 参数遗漏悄悄变成全表扫描。
 */

export interface AgentMonitorQuery {
  /** 单个智能体。与 `all` 互斥；两者都不传时后端返回 400。 */
  agent?: string;
  /** 显式请求全平台聚合。与 `agent` 互斥。 */
  all?: boolean;
  /** Unix 毫秒，含。 */
  from: number;
  /** Unix 毫秒，不含。 */
  to: number;
  /** 时间桶大小（毫秒），由前端按所选范围传入。 */
  step: number;
  /** 最近运行条数，最大 50。 */
  limit?: number;
}

export interface MonitorDurationStats {
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  /** 有效耗时样本数；0 表示没有可统计的终态运行。 */
  samples: number;
}

export interface MonitorTokenStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number;
  calls: number;
  /** usage JSON 可解析的运行数；0 表示上游没有上报。 */
  runsWithUsage: number;
}

export interface MonitorSummary {
  total: number;
  succeeded: number;
  failed: number;
  canceled: number;
  /** pending / running / interrupted 及未知非终态。 */
  active: number;
  successRate: number;
  duration: MonitorDurationStats;
  tokens: MonitorTokenStats;
}

export interface MonitorBucket {
  start: number;
  end: number;
  total: number;
  succeeded: number;
  failed: number;
  canceled: number;
  active: number;
  durationSamples: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface MonitorDurationBucket {
  key: 'lt1s' | '1sTo5s' | '5sTo30s' | '30sTo2m' | 'gte2m' | string;
  count: number;
}

export interface MonitorTriggerCount {
  trigger: string;
  count: number;
}

export interface MonitorRunSummary {
  id: string;
  /** 归属智能体；交互式运行通过 session 解析。 */
  agent: string;
  /** admission（异步任务）或 run（交互式运行）。 */
  source: string;
  state: string;
  trigger: string;
  startedAt: number;
  finishedAt: number;
  createdAt: number;
  durationMs: number;
  /** 该运行的 usage 总量；上游未上报时为 0。 */
  totalTokens: number;
}

/** 单个智能体在窗口内的汇总，全平台视图的排行与健康表使用。 */
export interface MonitorAgentSummary {
  agent: string;
  total: number;
  succeeded: number;
  failed: number;
  canceled: number;
  active: number;
  successRate: number;
  duration: MonitorDurationStats;
  tokens: MonitorTokenStats;
  /** 该智能体最新一行的时间锚点（createdAt）；0 表示窗口内无运行。 */
  lastRunAt: number;
}

export interface AgentMonitorResponse {
  /** 全平台请求时为空串。 */
  agent: string;
  all: boolean;
  from: number;
  to: number;
  step: number;
  generatedAt: number;
  /** 窗口内行数超过后端扫描上限时，统计只覆盖最新的一批。 */
  truncated: boolean;
  /** 实际参与聚合的行数与上限（50,000）。 */
  scannedRows: number;
  scanLimit: number;
  /** 按智能体汇总被 200 组上限截断。 */
  agentsTruncated: boolean;
  summary: MonitorSummary;
  agents: MonitorAgentSummary[];
  buckets: MonitorBucket[];
  durationDistribution: MonitorDurationBucket[];
  triggers: MonitorTriggerCount[];
  topSlowRuns: MonitorRunSummary[];
  recentRuns: MonitorRunSummary[];
}

export function getRunMonitor(query: AgentMonitorQuery): Promise<AgentMonitorResponse> {
  return request<AgentMonitorResponse>(agentClient, {
    url: AGENT.adminRunMonitor,
    method: 'GET',
    params: query,
  });
}
