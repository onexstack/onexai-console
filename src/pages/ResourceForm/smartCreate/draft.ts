import { askBuiltin } from '@/api/stream';
import { StreamRequestError } from '@/lib/api-client';

import { buildLocalDraft } from './matcher';
import { parseDraft } from './parse';
import { buildSmartCreatePrompt } from './prompt';
import type { SmartCatalog, SmartDraft } from './types';

export interface SmartDraftOptions {
  goal: string;
  catalog: SmartCatalog;
  existingAgentNames: Set<string>;
  preferredNamespace: string;
  signal: AbortSignal;
  /** 模型调用的总时限；超时后中止并回退本地匹配。默认 60 秒。 */
  timeoutMs?: number;
  onText?: (text: string) => void;
  onStatus?: (status: string) => void;
  onRunID?: (runID: string) => void;
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function describeFailure(error: unknown): string {
  if (error instanceof StreamRequestError) {
    if (error.status === 0) return '网络错误';
    if (error.status === 429) return '当前账号的模型配额已用尽';
    if (error.status >= 500) return `服务端错误（HTTP ${error.status}）`;
    return `请求失败（HTTP ${error.status}）`;
  }
  return error instanceof Error ? error.message : '未知错误';
}

/**
 * 让内置助手生成智能体草案；失败时回退到本地匹配。
 *
 * 401/403 直接抛出：前者说明会话失效，后者说明输入或策略被拒绝——同一段文本
 * 重试一次不会变好，静默回退会让用户以为「AI 只是没匹配到」。其余失败（网络、
 * 配额、5xx、非法 JSON、空输出）都可以用本地匹配继续。
 */
export async function createSmartDraft(options: SmartDraftOptions): Promise<SmartDraft> {
  const prompt = buildSmartCreatePrompt(options.goal, options.catalog, options.preferredNamespace);
  let text = '';
  let failure: string | null = null;

  options.onStatus?.('正在调用模型分析目标…');

  // A hung model call must not leave the analyzing step spinning forever. The
  // internal controller is aborted by the caller (user stop / mode switch) or by
  // the timeout; only the latter falls back, the former propagates the abort.
  const controller = new AbortController();
  let timedOut = false;
  const relayAbort = () => controller.abort();
  if (options.signal.aborted) controller.abort();
  options.signal.addEventListener('abort', relayAbort);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 60_000);

  try {
    await askBuiltin(prompt, {
      signal: controller.signal,
      onEvent: event => {
        if (event.runID) options.onRunID?.(event.runID);
        switch (event.type) {
          case 'delta':
            if (!event.reasoning) {
              text += event.text;
              options.onText?.(text);
            }
            break;
          case 'final':
            if (!text && event.text) {
              text = event.text;
              options.onText?.(text);
            }
            break;
          case 'error':
            throw new Error(event.error);
          case 'interrupt':
          case 'suspended':
            // 内置助手没有工具，任何暂停都说明服务端配置与这里的前提不一致。
            throw new Error('内置助手不应请求人工审批');
          default:
            break;
        }
      },
    });
  } catch (error) {
    if (isAbort(error)) {
      if (!timedOut) throw error;
      failure = '模型响应超时';
    } else if (
      error instanceof StreamRequestError &&
      (error.status === 401 || error.status === 403)
    ) {
      throw error;
    } else {
      failure = describeFailure(error);
    }
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', relayAbort);
  }

  // Even after a timeout or a late stream error, a complete JSON may already be
  // in hand; validate it before discarding the model's answer.
  if (text) {
    options.onStatus?.('正在校验推荐结果…');
    const parsed = parseDraft(text, {
      goal: options.goal,
      catalog: options.catalog,
      existingAgentNames: options.existingAgentNames,
    });
    if (parsed.ok) return parsed.draft;
    failure = failure ?? parsed.error;
  }

  const local = buildLocalDraft(
    options.goal,
    options.catalog,
    options.existingAgentNames,
    options.preferredNamespace
  );
  return {
    ...local,
    engine: 'local',
    notice: `AI 匹配不可用（${failure ?? '返回内容无法解析'}），已改用本地关键词匹配。`,
  };
}
