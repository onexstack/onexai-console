import { useCallback, useEffect, useRef, useState } from 'react';

import { stopDebugRun } from '@/api/agent';
import {
  approveDebug,
  askDebug,
  describeDebugError,
  type AgentImageRef,
  type ApproveDecision,
  type DebugEvent,
  type DebugInterrupt,
  type DebugStep,
  type DebugUsage,
} from '@/api/stream';
import type { AgentComposition, CapabilitySelection } from '@/api/types';

export type RunStatus = 'idle' | 'streaming' | 'suspended' | 'done' | 'stopped' | 'error';

/** 一条非增量事件，调试日志按时间展示。 */
export interface RunEvent {
  at: number;
  event: DebugEvent;
}

const MAX_EVENTS = 500;

export interface AgentRunState {
  status: RunStatus;
  answer: string;
  reasoning: string;
  steps: DebugStep[];
  usage: DebugUsage | null;
  interrupt: DebugInterrupt | null;
  images: string[];
  runId: string | null;
  error: string | null;
  startedAt: number | null;
  /** 非 delta 事件的有限历史：step/usage/interrupt/suspended/final/error。 */
  events: RunEvent[];
}

const INITIAL: AgentRunState = {
  status: 'idle',
  answer: '',
  reasoning: '',
  steps: [],
  usage: null,
  interrupt: null,
  images: [],
  runId: null,
  error: null,
  startedAt: null,
  events: [],
};

/**
 * 一次调试运行的状态机。
 *
 * 从 `DebugPanel` 抽出来，工作台与智能体详情共用。它只管「这一轮流成了什么」，
 * 不碰本机历史——历史由工作台的 transcript store 负责，两者分开才不会把一次的
 * 增量写进每一条消息。
 */
export function useAgentRun(agent: string | null) {
  const [state, setState] = useState<AgentRunState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const terminalRef = useRef(false);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  const apply = useCallback((event: DebugEvent) => {
    if (event.type === 'final' || event.type === 'error') terminalRef.current = true;
    setState(prev => {
      const next = reduceEvent(prev, event);
      // Delta is the answer itself; keeping it here would duplicate the
      // transcript and grow without bound. The other events are the run's
      // skeleton, which is what the debug log is for.
      const events =
        event.type === 'delta'
          ? prev.events
          : [...prev.events, { at: Date.now(), event }].slice(-MAX_EVENTS);
      return event.runID ? { ...next, runId: event.runID, events } : { ...next, events };
    });
  }, []);

  const send = useCallback(
    async (
      question: string,
      reasoning?: boolean,
      extras?: {
        images?: AgentImageRef[];
        capabilities?: CapabilitySelection;
        composition?: AgentComposition;
        sessionNonce?: string;
      }
    ) => {
      // A hostless playground run has no agent: the composition is the whole
      // configuration. Every other caller still needs a target agent.
      if (!agent && !extras?.composition) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      terminalRef.current = false;
      setState({ ...INITIAL, status: 'streaming', startedAt: Date.now() });

      try {
        await askDebug(agent, question, {
          signal: controller.signal,
          reasoning,
          images: extras?.images,
          capabilities: extras?.capabilities,
          composition: extras?.composition,
          sessionNonce: extras?.sessionNonce,
          onEvent: apply,
        });
        if (!terminalRef.current) {
          // 流在没有终止事件的情况下断了。不要假装成功。
          setState(prev =>
            prev.status === 'suspended'
              ? prev
              : {
                  ...prev,
                  status: 'error',
                  error: '运行没有返回结束事件（连接可能被中断）。',
                }
          );
        }
      } catch (error) {
        if (controller.signal.aborted) {
          setState(prev => ({ ...prev, status: 'stopped' }));
          return;
        }
        setState(prev => ({
          ...prev,
          status: 'error',
          error: describeDebugError(error, '运行失败'),
        }));
      }
    },
    [agent, apply]
  );

  const approve = useCallback(
    async (
      decision: ApproveDecision,
      extra?: { answers?: Record<string, string>; reason?: string }
    ) => {
      // Resuming is addressed by runID alone; a hostless run has no agent to
      // check here. The server still verifies the run belongs to this caller.
      const { interrupt, runId } = state;
      if (!interrupt || !runId) return;
      const controller = new AbortController();
      abortRef.current = controller;
      terminalRef.current = false;
      setState(prev => ({ ...prev, status: 'streaming', interrupt: null }));

      try {
        await approveDebug(
          {
            runID: runId,
            requestID: interrupt.requestID,
            decision,
            answers: extra?.answers,
            reason: extra?.reason,
          },
          { signal: controller.signal, onEvent: apply }
        );
        if (!terminalRef.current) {
          setState(prev =>
            prev.status === 'suspended'
              ? prev
              : { ...prev, status: 'error', error: '续流没有返回结束事件。' }
          );
        }
      } catch (error) {
        if (controller.signal.aborted) {
          setState(prev => ({ ...prev, status: 'stopped' }));
          return;
        }
        setState(prev => ({
          ...prev,
          status: 'error',
          error: describeDebugError(error, '续流失败'),
        }));
      }
    },
    [state, apply]
  );

  const stop = useCallback(async () => {
    const runId = state.runId;
    abortRef.current?.abort();
    if (runId) {
      try {
        await stopDebugRun(runId);
      } catch {
        // 停止失败不改变界面结论：本地已经中止了流。
      }
    }
    setState(prev => ({ ...prev, status: 'stopped' }));
  }, [state.runId]);

  const reset = useCallback(() => setState(INITIAL), []);

  /**
   * 放弃当前这一轮：先让服务端停掉运行（否则它会继续计费），再清空界面状态。
   *
   * 与 `stop()` 的区别：`stop()` 会把半截回答落成「已停止」，`cancel()` 用于
   * 新建会话、切换智能体、关闭页面这些「这一轮不要了」的场景。
   */
  const cancel = useCallback(async () => {
    const runId = state.runId;
    abortRef.current?.abort();
    if (runId) {
      try {
        await stopDebugRun(runId);
      } catch {
        // 服务端停止失败不影响本地放弃这一轮。
      }
    }
    setState(INITIAL);
  }, [state.runId]);

  return { state, send, approve, stop, reset, cancel };
}

function reduceEvent(prev: AgentRunState, event: DebugEvent): AgentRunState {
  switch (event.type) {
    case 'delta':
      return event.reasoning
        ? { ...prev, reasoning: prev.reasoning + event.text }
        : { ...prev, answer: prev.answer + event.text };
    case 'step':
      return { ...prev, steps: event.steps };
    case 'usage':
      return { ...prev, usage: event.usage };
    case 'image':
      return { ...prev, images: [...prev.images, ...event.images] };
    case 'interrupt':
      return { ...prev, interrupt: event.interrupt, status: 'suspended' };
    case 'suspended':
      // 运行暂停，不是结束：interrupt 还等着 /approve。
      return { ...prev, status: 'suspended' };
    case 'final':
      return {
        ...prev,
        answer: event.text || prev.answer,
        usage: event.usage ?? prev.usage,
        status: event.stopped ? 'stopped' : 'done',
        interrupt: null,
      };
    case 'error':
      return { ...prev, status: 'error', error: event.error };
    default:
      return prev;
  }
}
