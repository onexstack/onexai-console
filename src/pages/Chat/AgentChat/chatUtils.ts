import type { AgentImageRef, DebugUsage } from '@/api/stream';
import { dayjs } from '@/lib/date';

import type { ChatThread } from '../transcriptStore';

export const PANEL_TITLE = 'OneX 智能体';

export const LAST_AGENT_KEY = 'onexai-console_last_agent';
export const REASONING_KEY = 'onexai-console_agent_reasoning';

/** 把待发图片转成后端 `Input.images` 的形状（引用，不是字节）。 */
export function toImageRefs(
  assets: { assetId?: string; url?: string; name?: string }[]
): AgentImageRef[] {
  return assets.flatMap(asset =>
    asset.assetId
      ? [
          {
            asset_id: asset.assetId,
            ...(asset.url ? { url: asset.url } : {}),
            ...(asset.name ? { name: asset.name } : {}),
          },
        ]
      : []
  );
}

export const CHAT_LIMITS = {
  messageMaxLength: 3000,
  maxImages: 4,
  // 后端 media.DefaultKinds().image.MaxBytes 是 5 MiB；这里提前拦住，避免
  // 用户选完图才在上传接口收到「对象过大」。
  imageMaxBytes: 5 * 1024 * 1024,
  imageAccept: 'image/png,image/jpeg,image/webp,image/gif',
  maxAttachments: 3,
  attachmentMaxBytes: 8 * 1024 * 1024,
  attachmentAccept: '.pdf,.docx,.xlsx,.md,.txt',
} as const;

export function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatTime(timestamp: number): string {
  const time = dayjs(timestamp);
  return time.isSame(dayjs(), 'day') ? time.format('HH:mm') : time.format('MM-DD HH:mm');
}

export function formatDuration(durationMs?: number): string | null {
  if (!durationMs || durationMs < 0) return null;
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatTokens(usage?: DebugUsage | null): string | null {
  if (!usage?.totalTokens) return null;
  return `${usage.totalTokens} tokens`;
}

export function previewText(text?: string): string {
  if (!text) return '';
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 60 ? `${compact.slice(0, 60)}…` : compact;
}

export function statusText(status: string): string {
  switch (status) {
    case 'idle':
      return '空闲';
    case 'streaming':
      return '生成中';
    case 'suspended':
      return '等待确认';
    case 'done':
      return '已完成';
    case 'stopped':
      return '已停止';
    case 'error':
      return '失败';
    default:
      return status;
  }
}

export type ThreadBucket = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'earlier';

const BUCKET_LABELS: Record<ThreadBucket, string> = {
  today: '今天',
  yesterday: '昨天',
  thisWeek: '本周',
  thisMonth: '本月',
  earlier: '更早',
};

function bucketOf(updatedAt: number): ThreadBucket {
  const time = dayjs(updatedAt);
  const now = dayjs();
  if (time.isSame(now, 'day')) return 'today';
  if (time.isSame(now.subtract(1, 'day'), 'day')) return 'yesterday';
  if (time.isSame(now, 'week')) return 'thisWeek';
  if (time.isSame(now, 'month')) return 'thisMonth';
  return 'earlier';
}

/** 按「今天/昨天/本周/本月/更早」分组，空组不返回。 */
export function groupThreadsByTime(
  threads: ChatThread[]
): { bucket: ThreadBucket; label: string; items: ChatThread[] }[] {
  const order: ThreadBucket[] = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'earlier'];
  const groups = new Map<ThreadBucket, ChatThread[]>();
  for (const thread of threads) {
    const bucket = bucketOf(thread.updatedAt);
    const list = groups.get(bucket) ?? [];
    list.push(thread);
    groups.set(bucket, list);
  }
  return order
    .filter(bucket => groups.has(bucket))
    .map(bucket => ({ bucket, label: BUCKET_LABELS[bucket], items: groups.get(bucket) ?? [] }));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
