import { chatClient, request } from './client';
import { CHAT } from './endpoints';
import type { ResourceApiShape } from '@/ui';

import { CHAT_RESOURCE_DEFS, resourceApi, resourceWriter, type ResourceDef } from './resourceDefs';
import type { ResourceBinding } from './agent';
import type {
  AgentCoverage,
  Asset,
  ChatCommand,
  ChatMessageRecord,
  CommandNode,
  Conversation,
  ConversationMember,
  Coverage,
  ExecCommandResponse,
  LoginResponse,
  OncallGroup,
  Ticket,
  TicketNote,
} from './types';

// ─── 登录 ────────────────────────────────────────────────────────────────────

/**
 * 用 onexai 的登录端点换一枚令牌。
 *
 * 服务端的 provider 默认全关：它证明的是「你知道某个被部署方列在名单里的名字」，
 * 不是「你是这个人」。生产要接真实身份源（飞书 SSO 或 OneX 的 iam）。
 */
export async function login(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>(chatClient, {
    url: CHAT.login,
    method: 'POST',
    data: { provider: 'local', username, password },
  });
}

// ─── 会话 ────────────────────────────────────────────────────────────────────

/** 群列表。**这不是「我的会话」**：服务端返回机器人所在的所有群。 */
export async function listConversations(): Promise<Conversation[]> {
  return request<Conversation[]>(chatClient, { url: CHAT.conversations, method: 'GET' });
}

/** 某个群的历史消息。上游 limit 硬编码 50，没有分页参数。 */
export async function listHistory(convId: string): Promise<ChatMessageRecord[]> {
  const data = await request<{ messages?: ChatMessageRecord[] }>(chatClient, {
    url: CHAT.history(convId),
    method: 'GET',
  });
  return (data.messages ?? []).map(item => ({
    ...item,
    create_time: secondsToMillis(item.create_time),
  }));
}

/** 群成员。 */
export async function listMembers(convId: string): Promise<ConversationMember[]> {
  const data = await request<{ members?: ConversationMember[] }>(chatClient, {
    url: CHAT.members(convId),
    method: 'GET',
  });
  return data.members ?? [];
}

/** 跨会话的消息检索。**全库检索**，服务端没有 user/tenant/conv 过滤。 */
export async function searchMessages(q: string): Promise<ChatMessageRecord[]> {
  const data = await request<{ messages?: ChatMessageRecord[] }>(chatClient, {
    url: CHAT.search,
    method: 'GET',
    params: { q },
  });
  return (data.messages ?? []).map(item => ({
    ...item,
    create_time: secondsToMillis(item.create_time),
  }));
}

/**
 * `create_time` 是 `time.Unix()` 的**秒**，页面统一按毫秒渲染。
 * 归一放在 API 层，组件不再记「这个字段是秒还是毫秒」。
 */
function secondsToMillis(value: number | undefined): number | undefined {
  return typeof value === 'number' && value > 0 ? value * 1000 : value;
}

// ─── 工单（只读）────────────────────────────────────────────────────────────

export const ticketApi: ResourceApiShape<Ticket & Record<string, unknown>> = resourceApi(
  CHAT_RESOURCE_DEFS.tickets as ResourceDef<Ticket & Record<string, unknown>>
) as ResourceApiShape<Ticket & Record<string, unknown>>;

export const ticketBinding: ResourceBinding<Ticket & Record<string, unknown>> = {
  api: ticketApi,
  writable: false,
  create: async () => {
    throw new Error('工单不在控制台创建：它由 /open 命令或飞书卡片产生');
  },
  save: async () => {
    throw new Error('工单不在控制台修改：它由 /hand /close /mark 等命令驱动');
  },
};

/**
 * 一张工单的处理记录，按写入时间从旧到新。
 *
 * `total` 是这张工单实际有多少条；服务端对返回条数封顶（不翻页），所以
 * `total > notes.length` 说明被截断了，界面要把这件事说出来。
 */
export async function listTicketNotes(
  ticketId: string
): Promise<{ total: number; notes: TicketNote[] }> {
  const data = await request<{ total?: number; notes?: TicketNote[] }>(chatClient, {
    url: CHAT.ticketNotes(ticketId),
    method: 'GET',
  });
  return { total: data.total ?? 0, notes: data.notes ?? [] };
}

// ─── 值班组 ──────────────────────────────────────────────────────────────────

export const oncallGroupBinding: ResourceBinding<OncallGroup & Record<string, unknown>> = (() => {
  const def = CHAT_RESOURCE_DEFS['oncall-groups'] as ResourceDef<
    OncallGroup & Record<string, unknown>
  >;
  const writer = resourceWriter(def);
  return {
    api: resourceApi(def) as ResourceApiShape<OncallGroup & Record<string, unknown>>,
    writable: true,
    create: writer.create,
    save: writer.save,
  };
})();

// ─── 命令 ────────────────────────────────────────────────────────────────────

/** 命令树：TUI 弹窗与 TAB 补全用的命令/子命令/flag 全量。 */
export async function listCommandTree(): Promise<CommandNode[]> {
  const data = await request<{ commands?: CommandNode[] }>(chatClient, {
    url: CHAT.commandsTree,
    method: 'GET',
  });
  return data.commands ?? [];
}

/** 执行一条自由文本命令。`convId` 可为空（不落到某个群）。 */
export async function execCommand(command: string, convId?: string): Promise<ExecCommandResponse> {
  return request<ExecCommandResponse>(chatClient, {
    url: CHAT.commandsExec,
    method: 'POST',
    data: { command, ...(convId ? { conv_id: convId } : {}) },
  });
}

/** 按命令名执行，body 映射成 flags。flag 顺序不保证，顺序敏感的命令用 exec。 */
export async function execNamedCommand(
  name: string,
  flags: Record<string, unknown>
): Promise<ExecCommandResponse> {
  return request<ExecCommandResponse>(chatClient, {
    url: CHAT.cli(name),
    method: 'POST',
    data: flags,
  });
}

/** 命令目录（只读投影）。 */
export async function listChatCommands(params?: {
  offset?: number;
  limit?: number;
  namespace?: string;
}): Promise<{ total: number; items: ChatCommand[] }> {
  const data = await request<{ commands?: ChatCommand[]; count?: number }>(chatClient, {
    url: CHAT.chatCommands,
    method: 'GET',
    params,
  });
  return { total: data.count ?? 0, items: data.commands ?? [] };
}

export async function getChatCommand(
  name: string,
  namespace?: string
): Promise<ChatCommand | undefined> {
  const data = await request<{ command?: ChatCommand }>(chatClient, {
    url: CHAT.chatCommand(name),
    method: 'GET',
    params: namespace ? { namespace } : undefined,
  });
  return data.command;
}

/** 命令覆盖报告：哪些 agent 一条命令都没有。 */
export async function getCommandCoverage(): Promise<Coverage> {
  return request<Coverage>(chatClient, { url: CHAT.agentCommandCoverage, method: 'GET' });
}

export type { AgentCoverage };

// ─── 资产 ────────────────────────────────────────────────────────────────────

/** 上传一张图片（base64 JSON）。返回的 asset 用于消息的 images 字段。 */
export async function uploadAsset(file: File): Promise<Asset> {
  const data = await readAsBase64(file);
  const response = await request<{ asset?: Asset }>(chatClient, {
    url: CHAT.assets,
    method: 'POST',
    data: {
      kind: 'image',
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      data,
      source: 'upload',
    },
    timeout: 60_000,
  });
  if (!response.asset) throw new Error('上传成功但响应里没有 asset');
  return response.asset;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** 以 blob 取图片/资产，避免把 token 放进 `<img src>`。 */
export async function fetchBlob(url: string): Promise<Blob> {
  const response = await chatClient.instance.get<Blob>(url, { responseType: 'blob' });
  return response.data;
}

export const imagePath = CHAT.image;
export const assetContentPath = CHAT.assetContent;
