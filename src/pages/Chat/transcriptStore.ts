import type { DebugStep, DebugUsage } from '@/api/stream';
import type { AgentComposition, CapabilitySelection } from '@/api/types';

/**
 * 智能体直聊的本机记录。
 *
 * # 为什么是本机
 *
 * 浏览器可用的流式接口只有运行面：管理员 `/v1/admin/agent/ask`、普通用户
 * `/v1/user/agent/ask`（见 `api/runEndpoints`）。服务端没有会话列表/历史端点和
 * 查询入口；它只为每个 (智能体 × 当前用户) 保留一份记忆桶。因此这里保存的是
 * **界面历史**，不是服务端会话。页面必须把这个区别说清楚，不能暗示可以回放。
 */

/** 用户随消息发出的图片。`assetId` 用于带 Bearer 取图，`url` 作为兜底。 */
export interface StoredImageAsset {
  assetId: string;
  url?: string;
  name?: string;
}

/**
 * 随消息发出的附件元数据。
 *
 * 目前只做本地展示：共享的 `AgentAskRequest` 只有图片字段，chat 服务的
 * `POST /v1/assets` 也只接受 image。后端支持后再补 `attachmentId` 与上传。
 */
export interface StoredAttachment {
  name: string;
  size: number;
  mimeType?: string;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  steps?: DebugStep[];
  usage?: DebugUsage | null;
  images?: string[];
  /** 用户上传的图片（与 `images` 的服务端引用分开存，旧数据没有这个字段）。 */
  imageAssets?: StoredImageAsset[];
  /** 用户选择的附件（仅本地元数据）。 */
  attachments?: StoredAttachment[];
  /** done | stopped | error */
  status?: 'done' | 'stopped' | 'error';
  error?: string;
  runId?: string;
  /** 这一轮的耗时，毫秒。 */
  durationMs?: number;
  /**
   * 这一轮是在测试模式下发的。
   *
   * 与 `capabilities` 分开存：测试模式开着但选择等于全集时，请求里不会带
   * `capabilities`，这条消息仍然应该显示「测试模式」。
   */
  testMode?: boolean;
  /** 这一轮实际发送的能力收窄；缺省表示按生效能力全集运行。 */
  capabilities?: CapabilitySelection;
  /**
   * 这一轮由调试台发出时，发出时的组合快照。用于气泡上的「调试组合」标记，
   * 也让重试能复现当时的选择；普通聊天没有这个字段。
   */
  composition?: AgentComposition;
  createdAt: number;
}

export interface ChatThread {
  id: string;
  agent: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

const STORAGE_KEY = 'onexai-console_transcripts_v1';
const MAX_THREADS = 50;
const MAX_MESSAGES = 200;

type Bucket = Record<string, ChatThread[]>;

function bucketKey(userId: string | undefined, agent: string): string {
  return `${userId || 'anonymous'}::${agent}`;
}

function readAll(): Bucket {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Bucket;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(bucket: Bucket): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bucket));
  } catch {
    // 配额满或隐私模式：本机历史只是便利，写不进去不影响推理。
  }
}

export function loadThreads(userId: string | undefined, agent: string): ChatThread[] {
  const bucket = readAll();
  return bucket[bucketKey(userId, agent)] ?? [];
}

export function saveThreads(
  userId: string | undefined,
  agent: string,
  threads: ChatThread[]
): void {
  const bucket = readAll();
  const trimmed = threads
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_THREADS)
    .map(thread => ({
      ...thread,
      messages: thread.messages.slice(-MAX_MESSAGES),
    }));
  bucket[bucketKey(userId, agent)] = trimmed;
  writeAll(bucket);
}

export function newThread(agent: string): ChatThread {
  const now = Date.now();
  return {
    id: `thr-${now}-${Math.random().toString(36).slice(2, 8)}`,
    agent,
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

/** 线程标题取第一条用户消息的前 16 个字；改一次就不再变。 */
export function titleFrom(messages: StoredMessage[]): string {
  const first = messages.find(message => message.role === 'user');
  if (!first) return '新对话';
  const text = first.content.trim().replace(/\s+/g, ' ');
  return text.length > 16 ? `${text.slice(0, 16)}…` : text || '新对话';
}
