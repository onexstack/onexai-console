import { agentUrl, request, agentClient } from './client';
import { AGENT } from './endpoints';
import { runEndpointsForRun } from './runEndpoints';
import type { ResourceApiShape } from '@/ui';

import { AGENT_RESOURCE_DEFS, resourceApi, resourceWriter, type ResourceDef } from './resourceDefs';

/**
 * 一个声明式资源的绑定：读接口 + 写方法。
 *
 * 框架自带的「新建」是无参的（`ResourceApi.create()`），而这里每类资源都要填
 * 字段，所以入口关掉（`creatable: false`），改用本对象上的 `create(body)`。
 */
export interface ResourceBinding<T> {
  api: ResourceApiShape<T>;
  create: (body: Record<string, unknown>) => Promise<T>;
  save: (id: string, body: Record<string, unknown>) => Promise<T>;
  writable: boolean;
}

function bind<T>(def: ResourceDef<T>): ResourceBinding<T> {
  const writer = resourceWriter(def);
  return {
    api: resourceApi(def) as ResourceApiShape<T>,
    writable: writer.writable,
    create: writer.create,
    save: writer.save,
  };
}

/** 16 类平台资源。键即前端路由段。 */
export const platformResourceBindings: Record<
  string,
  ResourceBinding<Record<string, unknown>>
> = Object.fromEntries(
  Object.entries(AGENT_RESOURCE_DEFS).map(([key, def]) => [
    key,
    bind(def as ResourceDef<Record<string, unknown>>),
  ])
);

/** 键 → 绑定。 */
export const platformBindings: Record<
  string,
  ResourceBinding<Record<string, unknown>>
> = platformResourceBindings;

/**
 * 取一个绑定；键不存在时立刻抛错。
 *
 * `Record<string, T>` 的索引在 `noUncheckedIndexedAccess` 下是可空的，调用点
 * 到处写 `!` 只会把「拼错键」变成运行时 500。这里失败关闭，错误信息也明确。
 */
export function platformBinding(key: string): ResourceBinding<Record<string, unknown>> {
  const binding = platformResourceBindings[key];
  if (!binding) throw new Error(`未注册的资源：${key}`);
  return binding;
}

export { agentUrl };

/** 抓取/解析一张 AgentCard，不落库。失败是 ok=false，不是 HTTP 错误。 */
export async function previewA2ACard(body: {
  namespace?: string;
  kind?: string;
  execution?: unknown;
}): Promise<import('./types').A2APreviewResult> {
  return request<import('./types').A2APreviewResult>(agentClient, {
    url: AGENT.agentPreview,
    method: 'POST',
    data: body,
  });
}

// ─── 调试运行（SSE）──────────────────────────────────────────────────────────

/**
 * 调试运行的三个端点。
 *
 * runID 在**请求体**里，不在路径上：上游的 approve/stop 是「按 runID 操作」。
 * 停止不是 SSE（成功 204），审批与提问都是同一条流。
 */
export const DEBUG_ASK_URL = agentUrl(AGENT.debugAsk);
export const DEBUG_APPROVE_URL = agentUrl(AGENT.debugApprove);

/** 停止一次运行；端点由 runID 前缀决定（管理员 `dbg-` / 用户面其余）。 */
export async function stopDebugRun(runId: string): Promise<void> {
  await request<void>(agentClient, {
    url: runEndpointsForRun(runId).stop,
    method: 'POST',
    data: { runID: runId },
  });
}

export {
  cancelScheduledExecution,
  approveCustomCommand,
  getEffectiveAgent,
  invokeCustomCommand,
  listContextCommands,
  listContextSkills,
  listCustomCommandAudits,
  listScheduledExecutions,
  previewAgentBinding,
  testMcp,
  testModel,
  triggerScheduledRun,
} from './resourceDefs';
