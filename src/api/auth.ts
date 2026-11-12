import { agentClient, chatClient, request } from './client';
import { AGENT, CHAT } from './endpoints';
import type {
  AccessKeyCreated,
  AccessKeyListResponse,
  AccountUser,
  AuthProviders,
  CreateUserInput,
  FeishuBindStart,
  FeishuBindStatus,
  FeishuBinding,
  FeishuPeerBinding,
  FeishuPeerBindingListResponse,
  LoginResponse,
  MeResponse,
  UserListResponse,
} from './types';

/**
 * 账号与认证请求。
 *
 * # 为什么单独一个文件
 *
 * `api/chat.ts` 是「已登录后的业务读面」；这里的所有调用要么是换取令牌（登录、
 * 注册、飞书回调），要么是围绕当前账号本身（资料、密码、飞书绑定）。把它们混在
 * chat 业务里，会让「未登录也能调」与「必须带令牌」两种前提看起来一样。
 */

// ─── 登录 / 注册 ─────────────────────────────────────────────────────────────

/** 本部署支持哪些登录方式。登录页在拿到令牌之前调用。 */
export async function fetchAuthProviders(): Promise<AuthProviders> {
  return request<AuthProviders>(chatClient, {
    url: CHAT.providers,
    method: 'GET',
  });
}

/** 账号密码登录。 */
export async function loginWithPassword(
  username: string,
  password: string
): Promise<LoginResponse> {
  return request<LoginResponse>(chatClient, {
    url: CHAT.login,
    method: 'POST',
    data: { provider: 'local', username, password },
  });
}

/** 注册；成功时后端直接返回一枚已登录的令牌。 */
export async function register(
  username: string,
  password: string,
  displayName?: string
): Promise<LoginResponse> {
  return request<LoginResponse>(chatClient, {
    url: CHAT.register,
    method: 'POST',
    data: {
      username,
      password,
      ...(displayName ? { display_name: displayName } : {}),
    },
  });
}

/** 飞书登录第一步：拿到授权 URL。`redirect` 是登录后要回到的站内路径。 */
export async function fetchLarkAuthorizeURL(redirect: string): Promise<{ url: string }> {
  return request<{ url: string }>(chatClient, {
    url: CHAT.larkAuthorizeURL,
    method: 'GET',
    params: { redirect },
  });
}

/** 飞书登录第二步：把回调里的 code 换成令牌。 */
export async function loginWithLark(code: string, state: string): Promise<LoginResponse> {
  return request<LoginResponse>(chatClient, {
    url: CHAT.larkLogin,
    method: 'POST',
    data: { code, state },
  });
}

// ─── 当前账号 ───────────────────────────────────────────────────────────────

/** 当前账号、飞书绑定与可用的登录方式。 */
export async function fetchMe(): Promise<MeResponse> {
  return request<MeResponse>(chatClient, { url: CHAT.me, method: 'GET' });
}

/** 修改（或首次设置）密码。 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await request(chatClient, {
    url: CHAT.password,
    method: 'POST',
    data: { old_password: oldPassword, new_password: newPassword },
  });
}

// ─── 飞书绑定 ───────────────────────────────────────────────────────────────

/** 铸一个绑定码。 */
export async function startFeishuBind(): Promise<FeishuBindStart> {
  return request<FeishuBindStart>(chatClient, {
    url: CHAT.feishuBindStart,
    method: 'POST',
  });
}

/** 查询绑定走到了哪一步。 */
export async function feishuBindStatus(code: string): Promise<FeishuBindStatus> {
  return request<FeishuBindStatus>(chatClient, {
    url: CHAT.feishuBindStatus,
    method: 'GET',
    params: { code },
  });
}

/** 提交机器人私聊给的确认码。 */
export async function confirmFeishuBind(
  code: string,
  confirm: string
): Promise<{ bound: boolean }> {
  return request<{ bound: boolean }>(chatClient, {
    url: CHAT.feishuBindConfirm,
    method: 'POST',
    data: { code, confirm },
  });
}

/** 解绑当前账号的飞书身份。 */
export async function unbindFeishu(): Promise<void> {
  await request(chatClient, { url: CHAT.feishuBind, method: 'DELETE' });
}

/** 当前账号绑定的飞书身份（0 或 1 条）。 */
export async function listFeishuBindings(): Promise<FeishuBinding[]> {
  const data = await request<{ bindings?: FeishuBinding[] }>(chatClient, {
    url: CHAT.feishuBindings,
    method: 'GET',
  });
  return data.bindings ?? [];
}

// ─── 飞书身份 → 可用智能体（@peer） ─────────────────────────────────────────

export interface ListFeishuPeerBindingsParams {
  page: number;
  pageSize: number;
  keyword?: string;
  source?: string;
  userId?: string;
}

/**
 * 一页飞书绑定。
 *
 * 服务端按角色收窄：普通用户只会拿到自己的行，管理员拿到全部。前端没有
 * 「查别人的绑定」这种参数可传，`userId` 也只在管理员身份下生效。
 */
export async function listFeishuPeerBindings(
  params: ListFeishuPeerBindingsParams
): Promise<FeishuPeerBindingListResponse> {
  return request<FeishuPeerBindingListResponse>(chatClient, {
    url: CHAT.feishuPeerBindings,
    method: 'GET',
    params: {
      page: params.page,
      page_size: params.pageSize,
      ...(params.keyword ? { keyword: params.keyword } : {}),
      ...(params.source ? { source: params.source } : {}),
      ...(params.userId ? { user_id: params.userId } : {}),
    },
  });
}

/** 一条飞书绑定的最新状态。 */
export async function getFeishuPeerBinding(peerID: string): Promise<FeishuPeerBinding> {
  return request<FeishuPeerBinding>(chatClient, {
    url: CHAT.feishuPeerBinding(peerID),
    method: 'GET',
  });
}

/**
 * 覆盖一条绑定的可用智能体。
 *
 * 传目标数组而不是「增删一项」：重发同一请求仍是同一结果，断线重试不会把
 * 列表改两次。数组保持列表形状（与 CRD / onex-iam 一致），但控制台只能传 0
 * 或 1 个名字：每个飞书身份只对应一个智能体，服务端拒绝更多。空数组是合法
 * 值，表示「已绑定但暂时不开放 @peer」。
 */
export async function updateFeishuPeerBindingAgents(
  peerID: string,
  agents: string[]
): Promise<FeishuPeerBinding> {
  return request<FeishuPeerBinding>(chatClient, {
    url: CHAT.feishuPeerBindingAgents(peerID),
    method: 'PUT',
    data: { agents },
  });
}

/** 解绑一条飞书身份（管理员可代解绑）。 */
export async function unbindFeishuPeerBinding(peerID: string): Promise<void> {
  await request(chatClient, {
    url: CHAT.feishuPeerBinding(peerID),
    method: 'DELETE',
  });
}

// ─── 用户（管理员） ─────────────────────────────────────────────────────────

export interface ListUsersParams {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
  role?: string;
}

/** 一页账号。 */
export async function listUsers(params: ListUsersParams): Promise<UserListResponse> {
  return request<UserListResponse>(chatClient, {
    url: CHAT.users,
    method: 'GET',
    params: {
      page: params.page,
      page_size: params.pageSize,
      ...(params.keyword ? { keyword: params.keyword } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.role ? { role: params.role } : {}),
    },
  });
}

/** 管理员按 ID 读取单个账号（详情页刷新、深链都靠它，不依赖列表行状态）。 */
export async function getUser(id: string): Promise<AccountUser & { feishu?: FeishuBinding }> {
  const data = await request<{ user?: AccountUser & { feishu?: FeishuBinding } }>(chatClient, {
    url: CHAT.user(id),
    method: 'GET',
  });
  if (!data.user) throw new Error('账号响应里没有 user 字段');
  return data.user;
}

/** 管理员新建账号。创建后账号即可用用户名 + 密码登录。 */
export async function createUser(input: CreateUserInput): Promise<void> {
  await request(chatClient, {
    url: CHAT.users,
    method: 'POST',
    data: input,
  });
}

/** 管理员删除账号。账号的凭据与飞书绑定会一并清掉。 */
export async function deleteUser(id: string): Promise<void> {
  await request(chatClient, {
    url: CHAT.user(id),
    method: 'DELETE',
  });
}

/** 修改账号：显示名、状态、角色。只发送传进来的字段。 */
export async function updateUser(
  id: string,
  patch: { display_name?: string; status?: string; role?: string }
): Promise<void> {
  await request(chatClient, {
    url: CHAT.user(id),
    method: 'PATCH',
    data: patch,
  });
}

/** 管理员重置密码。 */
export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  await request(chatClient, {
    url: CHAT.userPassword(id),
    method: 'POST',
    data: { new_password: newPassword },
  });
}

// ─── 个人凭据（AK/SK） ──────────────────────────────────────────────────────

/**
 * 当前账号的访问密钥列表。
 *
 * 主语永远是「当前登录的账号」：后端从令牌里取用户 ID，前端没有「查别人的
 * 密钥」这种参数可传。
 */
export async function listAccessKeys(): Promise<AccessKeyListResponse> {
  return request<AccessKeyListResponse>(agentClient, {
    url: AGENT.aksk,
    method: 'GET',
  });
}

/** 新建一对 AK/SK。响应里的 `secret_key` 是唯一一次明文。 */
export async function createAccessKey(name: string): Promise<AccessKeyCreated> {
  return request<AccessKeyCreated>(agentClient, {
    url: AGENT.aksk,
    method: 'POST',
    data: { name },
  });
}

/**
 * 取一对密钥的 SecretKey 明文。
 *
 * 空串是一个真实答案：服务端还原不出明文（部署没有加密密钥）。它不是「还没
 * 取到」，页面据此显示「不可查看」而不是继续画掩码。
 */
export async function revealAccessKey(id: string): Promise<string> {
  const data = await request<{ secret_key?: string }>(agentClient, {
    url: AGENT.akskKey(id),
    method: 'GET',
  });
  return data.secret_key ?? '';
}

/** 启用 / 停用一对密钥。传目标状态，不传「翻转」，重发仍是同一结果。 */
export async function setAccessKeyEnabled(id: string, enabled: boolean): Promise<void> {
  await request(agentClient, {
    url: AGENT.akskKey(id),
    method: 'PUT',
    data: { enabled },
  });
}

/** 删除一对密钥。 */
export async function deleteAccessKey(id: string): Promise<void> {
  await request(agentClient, {
    url: AGENT.akskKey(id),
    method: 'DELETE',
  });
}
