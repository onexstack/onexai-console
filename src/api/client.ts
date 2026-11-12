import { createApiClient, type ApiClient, type AxiosRequestConfig } from '@/lib/api-client';

import { clearToken, getToken } from '@/auth/tokenStore';

/**
 * onexai 两个后端的访问层。
 *
 * # 两个客户端，一枚令牌
 *
 * - **chat**（`:9180`）：登录、值班组、会话、工单。浏览器面唯一签发令牌的地方。
 * - **agent**（`:9181`）：`/v1/agent/*` 声明式资源面（登录用户可读，写操作按
 *   owner 隔离）、`/v1/admin/*` 管理面与 `/v1/admin/agent/*` 调试运行。普通用户
 *   的运行走 `/v1/user/agent/*`，见 `./runEndpoints`。
 *
 * 两个服务共用同一枚 Bearer 令牌，前提是它们的 `jwt.key` 配置成同一个值——见
 * `~/.onexai/oai-{chat,agent}-apiserver.yaml` 的注释。客户端因此共用同一个
 * `getToken`，而不是各存一份。
 *
 * # 地址
 *
 * 开发期走本应用自带的代理（见 rsbuild.config.ts）：`/api/onexai/<服务>/...`。
 * 用 `PUBLIC_ONEXAI_*` 覆盖是为了让部署能换地址而不改代码——生产还没有这两个
 * 前缀的网关路由，那是本机部署阶段刻意留的待办。
 */
export const CHAT_BASE_URL = (
  process.env.PUBLIC_ONEXAI_CHAT_BASE_URL || '/api/onexai/chat'
).replace(/\/+$/, '');
export const AGENT_BASE_URL = (
  process.env.PUBLIC_ONEXAI_AGENT_BASE_URL || '/api/onexai/agent'
).replace(/\/+$/, '');

/**
 * 归一化后的 API 错误。
 *
 * onexai 的错误体是 `{reason, message, metadata}`（与 OneX 平台一致），`reason`
 * 是给人排查用的（如 `Forbidden`、`NotFound`），`message` 是给用户看的。
 */
export class ApiError extends Error {
  status?: number;
  reason?: string;

  constructor(status: number | undefined, reason: string | undefined, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
  }
}

interface ErrorBody {
  reason?: string;
  message?: string;
}

/** 从任意响应体里取 onexai 的错误字段；代理返回的纯文本/HTML 页面不算。 */
function errorFields(data: unknown): ErrorBody {
  if (!data || typeof data !== 'object') return {};
  const body = data as Record<string, unknown>;
  return {
    reason: typeof body['reason'] === 'string' ? body['reason'] : undefined,
    message: typeof body['message'] === 'string' ? body['message'] : undefined,
  };
}

/**
 * 客户端 → 服务名的映射，只用于把失败说清楚。
 *
 * 开发期后端未启动时 rsbuild 代理会返回 504（`ECONNREFUSED` 映射而来），生产
 * 网关也是 502/504；只说「请求失败」会让人去翻浏览器网络面板。名字里带端口，
 * 本机排查时能直接对上要启动的进程。
 */
const SERVICE_HINTS: ReadonlyArray<readonly [string, string]> = [
  [CHAT_BASE_URL, 'oai-chat-apiserver（9180）'],
  [AGENT_BASE_URL, 'oai-agent-apiserver（9181）'],
];

function serviceHint(client: ApiClient): string {
  const baseURL = client.instance.defaults.baseURL ?? '';
  return SERVICE_HINTS.find(([prefix]) => baseURL.startsWith(prefix))?.[1] ?? '智能体平台服务';
}

/**
 * 没有结构化错误体时的兜底文案。
 *
 * 开发期请求经过 rsbuild 代理：后端没起来时拿到的是 502/503/504 的纯文本页，
 * axios 不会把它解析成 `{message}`。以前这里统一显示「请求失败」，用户分不清
 * 是后端在重启还是请求本身有问题；带上服务名和状态码就能一眼判断。
 */
function fallbackMessage(client: ApiClient, status: number | undefined): string {
  const service = serviceHint(client);
  if (status === undefined) {
    return `无法连接 ${service}，请确认服务已启动`;
  }
  if (status === 502 || status === 503 || status === 504) {
    return `${service} 暂无响应（HTTP ${status}），可能正在启动或重启，请稍后重试`;
  }
  return `请求失败（HTTP ${status}）`;
}

function makeClient(baseURL: string): ApiClient {
  return createApiClient({
    baseURL,
    timeout: 30000,
    getToken,
    // 令牌过期或无效时清掉它：下一次渲染就落回登录页，而不是让每个页面各自
    // 显示一次 401。onexai 的登录没有刷新端点（签发端只有 /v1/auth/login），
    // 所以这里没有 refreshToken 可给——重新登录是唯一的路。
    onUnauthorized: clearToken,
  });
}

export const chatClient = makeClient(CHAT_BASE_URL);
export const agentClient = makeClient(AGENT_BASE_URL);

/** 供 SSE 调用拼最终地址；`streamRequest` 要的是绝对路径。 */
export function agentUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${AGENT_BASE_URL}${normalized}`;
}

/** SSE 的令牌来源，与 axios 客户端共用同一份语义（只读令牌，不刷新）。 */
export const streamAuth = { getToken };

/**
 * 通用请求助手：成功返回 `response.data`，失败抛出归一化的 `ApiError`。
 *
 * onexai 的响应规范：成功是裸数据（无包裹），失败是 `{reason, message}`。
 */
export async function request<T>(client: ApiClient, config: AxiosRequestConfig): Promise<T> {
  try {
    const response = await client.instance.request<T>(config);
    return response.data;
  } catch (err) {
    const axiosErr = err as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    const status = axiosErr.response?.status;
    const { reason, message } = errorFields(axiosErr.response?.data);
    throw new ApiError(status, reason, message || fallbackMessage(client, status));
  }
}
