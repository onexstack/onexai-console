import { streamRequest, StreamRequestError, type SseEvent } from '@/lib/api-client';

import { agentClient, agentUrl, request, streamAuth } from './client';
import { AGENT } from './endpoints';
import { runEndpoints, runEndpointsForRun } from './runEndpoints';
import type { AgentComposition, CapabilitySelection } from './types';

/**
 * 管理面调试运行的事件形状。
 *
 * # 这是服务端映射出来的形状，不是上游的
 *
 * 上游（onexai 的 `/v1/agent/ask`）用**数字**表示事件类型（0..10：unspecified /
 * progress / toolStep / reasoning / answer / done / failed / stopped / interrupted /
 * usage / suspended），而且没有 `[DONE]` 终止符。管理面把它映射成这里的字符串
 * 联合——数字枚举是上游的内部表示，让浏览器去认它等于把上游的枚举顺序变成前端
 * 契约的一部分。
 *
 * 形状与 `internal/agent/handler/admin_debug.go` 保持一致；改动任一处必须同时改
 * 另一处（这一条没有生成器兜底）。
 */

/** 一个工具调用的步骤。 */
export interface DebugStep {
  name: string;
  /** pending | ok | fail */
  status: string;
  durationMs?: number;
  tokens?: number;
  id?: string;
  /**
   * 工具返回了什么。
   *
   * **管理面会上报它，chat 面不会**：chat 面的 sink 把步骤转成生成的 proto 消息，
   * 那条消息没有这个字段；管理面自己映射，所以能把它带给浏览器。值为空只表示
   * 工具还没返回或确实没返回内容，不表示这条链路永远拿不到。
   */
  result?: string;
}

/** 一轮运行的用量。 */
export interface DebugUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  calls?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
}

/** 审批/提问暂停里的一项。 */
export interface DebugInterruptRequest {
  address: string;
  toolName: string;
  question: string;
  options: string[];
  multiSelect: boolean;
  /** permission（工具调用被拦）| question（模型主动提问） */
  kind: string;
  arguments: string;
}

/** 一段流以暂停收尾；run 未结束，等待 `/approve` 续流。 */
export interface DebugInterrupt {
  requestID: string;
  requests: DebugInterruptRequest[];
}

/** 归一化后的事件。 */
export type DebugEvent =
  | { type: 'delta'; text: string; reasoning: boolean; runID?: string }
  | { type: 'step'; steps: DebugStep[]; runID?: string }
  | { type: 'usage'; usage: DebugUsage; runID?: string }
  | { type: 'image'; images: string[]; runID?: string }
  | { type: 'interrupt'; interrupt: DebugInterrupt; runID?: string }
  /**
   * 这一段流因为运行**暂停**而结束（等一个人回答）。run 没结束：`interrupt` 事件里
   * 那个暂停还在等 `/approve`。它单独一种类型而不是带 flag 的 `final`，因为把它
   * 画成「已结束」会盖掉界面上唯一还能做的动作。
   */
  | { type: 'suspended'; runID?: string }
  | { type: 'final'; text: string; usage?: DebugUsage; stopped: boolean; runID?: string }
  | { type: 'error'; error: string; runID?: string };

/** 审批决定，与服务端的 decision 取值一致。 */
export type ApproveDecision = 'allow' | 'deny' | 'allow_all';

export interface ApproveBody {
  runID: string;
  requestID: string;
  decision: ApproveDecision;
  /** 仅 kind === 'question' 时使用，键是请求的 address。 */
  answers?: Record<string, string>;
  reason?: string;
}

/**
 * 解析一行 `data: {json}`。
 *
 * - `type` 未知 → 返回 null（向前兼容：服务端加了新事件类型，前端忽略而不是崩）。
 * - 正文不是 JSON、或缺少 `type` → **抛错**。那是协议级故障，静默吞掉会让一次
 *   「格式对不上」表现成「智能体没回应」，而这两件事的排查方向完全不同。
 */
export function parseDebugEvent(event: SseEvent): DebugEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(event.data);
  } catch {
    throw new Error(`无法解析调试事件（非 JSON）：${truncate(event.data)}`);
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('调试事件不是对象');

  const obj = raw as Record<string, unknown>;
  const runID = optString(obj['runID']);
  switch (obj['type']) {
    case 'delta':
      return {
        type: 'delta',
        text: optString(obj['text']) ?? '',
        reasoning: obj['reasoning'] === true,
        runID,
      };
    case 'step':
      return { type: 'step', steps: parseSteps(obj['steps']), runID };
    case 'usage':
      return { type: 'usage', usage: parseUsage(obj['usage']), runID };
    case 'image':
      return {
        type: 'image',
        images: Array.isArray(obj['images'])
          ? obj['images'].filter((value): value is string => typeof value === 'string')
          : [],
        runID,
      };
    case 'interrupt':
      return { type: 'interrupt', interrupt: parseInterrupt(obj['interrupt']), runID };
    case 'suspended':
      return { type: 'suspended', runID };
    case 'final':
      return {
        type: 'final',
        text: optString(obj['text']) ?? '',
        usage: obj['usage'] === undefined ? undefined : parseUsage(obj['usage']),
        stopped: obj['stopped'] === true,
        runID,
      };
    case 'error':
      return { type: 'error', error: optString(obj['error']) ?? '未知错误', runID };
    default:
      return null;
  }
}

function parseSteps(value: unknown): DebugStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map(s => ({
      name: optString(s['name']) ?? '',
      status: optString(s['status']) ?? '',
      durationMs: optNumber(s['durationMs']),
      tokens: optNumber(s['tokens']),
      id: optString(s['id']),
      result: optString(s['result']),
    }));
}

function parseUsage(value: unknown): DebugUsage {
  if (typeof value !== 'object' || value === null) return {};
  const u = value as Record<string, unknown>;
  return {
    promptTokens: optNumber(u['promptTokens']),
    completionTokens: optNumber(u['completionTokens']),
    totalTokens: optNumber(u['totalTokens']),
    reasoningTokens: optNumber(u['reasoningTokens']),
    calls: optNumber(u['calls']),
  };
}

function parseInterrupt(value: unknown): DebugInterrupt {
  if (typeof value !== 'object' || value === null)
    throw new Error('interrupt 事件缺少 interrupt 字段');
  const i = value as Record<string, unknown>;
  const requestID = optString(i['requestID']);
  if (!requestID) throw new Error('interrupt 事件缺少 requestID');
  return { requestID, requests: parseInterruptRequests(i['requests']) };
}

function parseInterruptRequests(value: unknown): DebugInterruptRequest[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map(r => ({
      address: optString(r['address']) ?? '',
      toolName: optString(r['toolName']) ?? '',
      question: optString(r['question']) ?? '',
      options: Array.isArray(r['options'])
        ? r['options'].filter((o): o is string => typeof o === 'string')
        : [],
      multiSelect: r['multiSelect'] === true,
      kind: optString(r['kind']) ?? 'permission',
      arguments: optString(r['arguments']) ?? '',
    }));
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 一张随消息发送的图片引用（后端 `agent.v1.ImageRef`）。
 *
 * 字段名与 proto 一致：`asset_id` / `mime_type` 是 snake_case，其余是 proto
 * 字段名本身。控制台与内部面共用 `AgentAskRequest`，图片以引用而不是字节
 * 随消息走；模型边界才把它解析成 data URL。
 */
export interface AgentImageRef {
  asset_id: string;
  url?: string;
  name?: string;
  mime_type?: string;
}

/** 事件回调。 */
export interface DebugStreamOptions {
  signal?: AbortSignal;
  onEvent: (event: DebugEvent) => void;
  /** 请求推理流；不传时保持上游的「未设置」语义。 */
  reasoning?: boolean;
  /**
   * 随消息发送的图片引用。
   *
   * 三条 ask 入口（内部 `/v1/agent/ask`、管理员 `/v1/admin/agent/ask`、普通
   * 用户 `/v1/user/agent/ask`）共用 `AgentAskRequest`，图片放在
   * `input.images` 里。控制台无法控制身份/生命周期字段；这些字段由服务端
   * 推导，显式提交会被 400 拒绝。
   */
  images?: AgentImageRef[];
  /**
   * 测试模式的能力子集。
   *
   * 不传 = 按智能体生效能力全集运行；传入 = 本次运行只使用这些名字。后端只
   * 接受生效能力的子集，越界会以 400 拒绝，因此前端永远只从 `/effective`
   * 返回的列表里勾选。
   */
  capabilities?: CapabilitySelection;
  /**
   * 调试台的能力组合。
   *
   * 有 agent 时**替换**宿主智能体的提示词与能力；没有 agent 时它就是整轮运行
   * 的全部配置（无宿主 playground，执行主体是当前用户）。不能与 capabilities
   * 同时发送。普通聊天与测试模式不传。
   */
  composition?: AgentComposition;
  /**
   * 组合调试的会话标识。同一组合 + 同一 nonce 共享服务端记忆桶；组合变化或
   * 「新会话」时换一个。只在发送 composition 时有意义。
   */
  sessionNonce?: string;
}

/**
 * 起一轮调试运行（或对某个暂停给出答复后的续流）。
 *
 * `agent` 为 null 表示无宿主 playground：请求固定走用户面，且不带 selection
 * （服务端允许空 selection + composition）。管理面的契约始终是「以 agent
 * owner 执行」，所以它不承载这种运行。
 *
 * 请求体就是后端的 `AgentAskRequest`：内容在 `input`，目标在 `selection`，
 * 生成参数在 `generation`。身份、会话、run ID、计量等字段由服务端推导，
 * 控制台不发送（发送会被 400 拒绝）。
 */
export async function askDebug(
  agent: string | null,
  question: string,
  options: DebugStreamOptions
): Promise<void> {
  await streamRequest({
    // 命名 agent：管理员以 owner、普通用户以本人身份运行。无宿主：固定用户面。
    url: agent ? agentUrl(runEndpoints().ask) : agentUrl(AGENT.userAsk),
    method: 'POST',
    body: {
      input: {
        text: question,
        ...(options.images?.length ? { images: options.images } : {}),
      },
      ...(agent ? { selection: { agents: [agent] } } : {}),
      ...(options.reasoning === undefined ? {} : { generation: { reasoning: options.reasoning } }),
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
      ...(options.composition === undefined ? {} : { composition: options.composition }),
      ...(options.composition === undefined || !options.sessionNonce
        ? {}
        : { sessionNonce: options.sessionNonce }),
    },
    signal: options.signal,
    auth: streamAuth,
    onEvent: event => dispatch(event, options.onEvent),
  });
}

/** 内置助手的一次无状态生成。 */
export interface BuiltinAskOptions {
  signal?: AbortSignal;
  onEvent: (event: DebugEvent) => void;
}

/**
 * 调用内置助手（`selection.agents: ["default"]`）。
 *
 * # 为什么固定走用户面
 *
 * `/v1/agent/ask` 是 AK/SK 签名面，浏览器没有可用的签名密钥。它的 Bearer
 * 同源面 `/v1/user/agent/ask` 以**当前用户**身份执行、按用户配额计量，并用
 * 控制台事件格式（`delta` / `final`）输出——管理面则要求先解析出一个真实
 * agent 的 owner，`default` 在那里没有 owner，因此不能走管理面。
 *
 * 智能创建只需要一次无工具的文本生成，不涉及审批、图片与能力子集。
 */
export async function askBuiltin(question: string, options: BuiltinAskOptions): Promise<void> {
  await streamRequest({
    url: agentUrl(AGENT.userAsk),
    method: 'POST',
    body: {
      selection: { agents: ['default'] },
      input: { text: question },
    },
    signal: options.signal,
    auth: streamAuth,
    onEvent: event => dispatch(event, options.onEvent),
  });
}

/**
 * 尽力停止一次内置助手运行。
 *
 * 用户面只接受自己铸造的 `usr-` runID；其他前缀直接忽略。停止失败不向用户
 * 报错：取消生成的语义是「我不再等这个结果」，不是「服务端必须立刻停下」。
 */
export async function stopBuiltinRun(runID: string | null | undefined): Promise<void> {
  if (!runID || !runID.startsWith('usr-')) return;
  try {
    await request<void>(agentClient, {
      url: AGENT.userStop,
      method: 'POST',
      data: { runID },
    });
  } catch {
    // Best effort: the stream was already aborted from the caller's side.
  }
}

/** 答复一个暂停并消费续流。端点由 runID 前缀决定，而不是当前角色。 */
export async function approveDebug(body: ApproveBody, options: DebugStreamOptions): Promise<void> {
  await streamRequest({
    url: agentUrl(runEndpointsForRun(body.runID).approve),
    method: 'POST',
    body,
    signal: options.signal,
    auth: streamAuth,
    onEvent: event => dispatch(event, options.onEvent),
  });
}

function dispatch(event: SseEvent, onEvent: (e: DebugEvent) => void): void {
  const parsed = parseDebugEvent(event);
  if (parsed) onEvent(parsed);
}

/** 把任意抛出物说成一句可展示的话；带上 HTTP 状态，因为 403 与网络错误要分开。 */
export function describeDebugError(err: unknown, fallback: string): string {
  if (err instanceof StreamRequestError) {
    if (err.status === 0) return `${fallback}（网络错误）`;
    if (err.status === 403) {
      // 组合调试的 403 会点名被拒绝的资源；只显示「没有授权」会让人对着两份
      // 列表逐项猜。
      const detail = errorMessage(err.body);
      return detail
        ? `${fallback}（HTTP 403：${detail}）`
        : `${fallback}（HTTP 403：这一次运行没有被授权，或该智能体的知识库/工具超出你的授权范围）`;
    }
    if (err.status === 401) return `${fallback}（HTTP 401：会话已失效，请重新登录）`;
    // 400 的响应体带着服务端的具体理由（例如测试模式选了不在生效集合里的
    // 能力）。只显示「HTTP 400」会让人对着两份列表逐项比对，这正是后端把
    // 名字写进 message 的原因。
    if (err.status === 400) {
      const detail = errorMessage(err.body);
      return detail ? `${fallback}（${detail}）` : `${fallback}（HTTP 400：请求参数无效）`;
    }
    return `${fallback}（HTTP ${err.status}）`;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** 从 `{code,message}` 错误体里取出 message；不是那种形状就返回空串。 */
function errorMessage(body: string | undefined): string {
  if (!body) return '';
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return '';
    const message = (parsed as Record<string, unknown>)['message'];
    return typeof message === 'string' ? message : '';
  } catch {
    return '';
  }
}
