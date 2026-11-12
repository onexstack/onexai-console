import type { DebugStep, DebugUsage } from '@/api/stream';
import type { AgentComposition } from '@/api/types';

import type { StoredMessage } from '../transcriptStore';
import { emptyComposition, newSessionNonce } from './debugComposition';

/**
 * 调试台的本机记录。
 *
 * 用 sessionStorage 而不是 localStorage：调试台是「这一次打开页面时的试验」，
 * 关掉标签页就结束；服务端的记忆桶由 `composition + nonce` 决定，nonce 在
 * 刷新后保留（同一标签页），所以刷新还能接着聊。消息只存本机，服务端没有
 * 会话历史接口。
 */

export interface DebugTurnLog {
  id: string;
  at: number;
  composition: AgentComposition;
  reasoning: boolean;
  status: 'streaming' | 'done' | 'stopped' | 'error' | 'suspended';
  runId?: string;
  durationMs?: number;
  usage?: DebugUsage | null;
  steps?: DebugStep[];
  error?: string;
  /** 本轮实际覆盖的模型名；空表示使用部署默认。 */
  model?: string;
}

export interface DebugSessionRecord {
  composition: AgentComposition;
  nonce: string;
  messages: StoredMessage[];
  turns: DebugTurnLog[];
  savedAt: number;
}

const STORAGE_KEY = 'onexai-console_debug_v1';
const MAX_MESSAGES = 100;
const MAX_TURNS = 50;
const MAX_RESULT_CHARS = 500;

type Bucket = Record<string, DebugSessionRecord>;

function bucketKey(userId: string | undefined): string {
  // 调试台无宿主：同一用户只有一份 playground 记录。组合与 nonce 在记录里，
  // 组合变化由调用方清空/换桶。
  return `${userId || 'anonymous'}::playground`;
}

function readAll(): Bucket {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Bucket;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(bucket: Bucket): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(bucket));
  } catch {
    // 配额满或隐私模式：本机记录只是便利，写不进去不影响运行。
  }
}

function trimSteps(steps?: DebugStep[]): DebugStep[] | undefined {
  if (!steps || steps.length === 0) return undefined;
  return steps.map(step => ({
    ...step,
    result:
      step.result && step.result.length > MAX_RESULT_CHARS
        ? `${step.result.slice(0, MAX_RESULT_CHARS)}…`
        : step.result,
  }));
}

export function newDebugSession(
  composition: AgentComposition = emptyComposition()
): DebugSessionRecord {
  return {
    composition,
    nonce: newSessionNonce(),
    messages: [],
    turns: [],
    savedAt: Date.now(),
  };
}

export function loadDebugSession(userId: string | undefined): DebugSessionRecord | null {
  const record = readAll()[bucketKey(userId)];
  return record ?? null;
}

export function saveDebugSession(userId: string | undefined, record: DebugSessionRecord): void {
  const bucket = readAll();
  bucket[bucketKey(userId)] = {
    ...record,
    messages: record.messages.slice(-MAX_MESSAGES),
    turns: record.turns.slice(-MAX_TURNS).map(turn => ({ ...turn, steps: trimSteps(turn.steps) })),
    savedAt: Date.now(),
  };
  writeAll(bucket);
}
