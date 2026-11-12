import type { DebugStep, DebugUsage } from '@/api/stream';
import type { AgentComposition, CapabilitySelection } from '@/api/types';

import type { StoredAttachment, StoredImageAsset } from '../transcriptStore';

export type AgentChatView = 'chat' | 'settings' | 'history' | 'debug';

export interface AgentOption {
  value: string;
  label: string;
  /** 副行描述，已折叠为单行；同时参与搜索。 */
  description?: string;
  disabled?: boolean;
  /** 外部 A2A 智能体：由对端执行，没有平台能力、模型和工具。 */
  external?: boolean;
}

/**
 * 统一渲染「已存消息」与「正在流式生成的消息」。
 *
 * `pending` 为真表示这一轮还没结束：思考块标题显示「思考中」、Markdown 走节流、
 * 发送键换成停止键。
 */
export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  steps?: DebugStep[];
  usage?: DebugUsage | null;
  images?: string[];
  imageAssets?: StoredImageAsset[];
  attachments?: StoredAttachment[];
  status?: 'done' | 'stopped' | 'error';
  error?: string;
  createdAt: number;
  durationMs?: number;
  pending?: boolean;
  /** 这一轮由测试模式发出。 */
  testMode?: boolean;
  /** 这一轮实际发送的能力收窄；缺省表示全集。 */
  capabilities?: CapabilitySelection;
  /** 这一轮由调试台发出时的组合快照。 */
  composition?: AgentComposition;
}

export interface PendingImage {
  id: string;
  name: string;
  previewURL: string;
  status: 'uploading' | 'ready' | 'error';
  assetId?: string;
  url?: string;
}

export interface PendingAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface ApprovalExtra {
  answers?: Record<string, string>;
  reason?: string;
}
