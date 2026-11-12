import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentComposition } from '@/api/types';
import type { ApproveDecision } from '@/api/stream';

import { useAgentRun } from '../useAgentRun';
import type { StoredAttachment, StoredImageAsset, StoredMessage } from '../transcriptStore';
import { REASONING_KEY, toImageRefs, uid } from './chatUtils';
import {
  compositionHash,
  emptyComposition,
  isCompositionEmpty,
  normalizeComposition,
  newSessionNonce,
} from './debugComposition';
import {
  loadDebugSession,
  newDebugSession,
  saveDebugSession,
  type DebugSessionRecord,
  type DebugTurnLog,
} from './debugStore';
import type { ApprovalExtra } from './types';

/**
 * 调试台（无宿主 playground）的会话状态。
 *
 * 与普通聊天**分开**一个 `useAgentRun` 实例：调试台可以有自己的在飞运行，
 * 切回聊天不会把两边的事件混在一起。运行请求不带 agent，执行主体是当前用户；
 * 本机记录用 sessionStorage 持久化，按用户分桶，`nonce` 在刷新后保留，因此
 * 多轮上下文还能接上。
 */

/**
 * 读回本机记录：旧记录可能缺少新字段或数组，规范化后再交给界面。
 *
 * 旧记录没有 `namespace`：补成当前业务空间，避免把「在哪个空间运行」这个
 * 决定悄悄留在上一版前端。
 */
function hydrate(record: DebugSessionRecord | null, referrer: string): DebugSessionRecord {
  if (!record) return newDebugSession(emptyComposition(referrer));
  return {
    ...record,
    composition: normalizeComposition({
      ...emptyComposition(referrer),
      ...(record.composition ?? {}),
      namespace: record.composition?.namespace || referrer,
    }),
    messages: record.messages ?? [],
    turns: record.turns ?? [],
  };
}

export function useDebugSession(userId: string | undefined, referrerNamespace: string) {
  const [session, setSession] = useState<DebugSessionRecord>(() =>
    hydrate(loadDebugSession(userId), referrerNamespace)
  );
  const [input, setInput] = useState('');
  // 思考偏好与聊天共用同一个键：用户在调试台开的思考，回到聊天也保持。
  const [reasoning, setReasoning] = useState(() => {
    try {
      return localStorage.getItem(REASONING_KEY) === '1';
    } catch {
      return false;
    }
  });

  const run = useAgentRun(null);
  const finalizedRef = useRef('');

  // 离开调试台时放弃在飞的一轮：先让服务端停掉运行，而不是只断开浏览器的流。
  // 用 ref 取最新的 cancel，避免 runId 变化导致这个 effect 反复触发。
  const cancelRef = useRef(run.cancel);
  cancelRef.current = run.cancel;
  useEffect(
    () => () => {
      void cancelRef.current();
    },
    []
  );

  // 同一用户只有一份 playground 记录；组合与 nonce 决定服务端会话桶。
  useEffect(() => {
    saveDebugSession(userId, session);
  }, [session, userId]);

  // 业务空间变化就是组合变化：裸名解析与 grant 判定都会换一个引用方，所以
  // 服务端会话桶也要换。没有消息时只更新字段，不打断刚打开的面板。
  useEffect(() => {
    if (!referrerNamespace) return;
    setSession(prev => {
      if ((prev.composition.namespace ?? '') === referrerNamespace) return prev;
      const composition = { ...prev.composition, namespace: referrerNamespace };
      if (prev.messages.length === 0 && prev.turns.length === 0) {
        return { ...prev, composition };
      }
      return { ...newDebugSession(composition), nonce: newSessionNonce() };
    });
  }, [referrerNamespace]);

  useEffect(() => {
    try {
      localStorage.setItem(REASONING_KEY, reasoning ? '1' : '0');
    } catch {
      // 隐私模式：偏好写不进去不影响发送。
    }
  }, [reasoning]);

  const status = run.state.status;
  const running = status === 'streaming' || status === 'suspended';

  // 一次运行结束后落进本机记录。与普通聊天同样的「只落一次」保护：终止状态
  // 可能被多次渲染。
  useEffect(() => {
    if (!['done', 'stopped', 'error'].includes(status)) return;
    const key = run.state.runId ?? String(run.state.startedAt ?? '');
    if (finalizedRef.current === key) return;
    finalizedRef.current = key;

    const state = run.state;
    const assistant: StoredMessage | null =
      state.answer || state.error
        ? {
            id: uid('msg'),
            role: 'assistant',
            content: state.answer,
            reasoning: state.reasoning,
            steps: state.steps,
            usage: state.usage,
            images: state.images,
            status:
              state.status === 'error' ? 'error' : state.status === 'stopped' ? 'stopped' : 'done',
            error: state.error ?? undefined,
            runId: state.runId ?? undefined,
            durationMs: state.startedAt ? Date.now() - state.startedAt : undefined,
            createdAt: Date.now(),
          }
        : null;

    setSession(prev => {
      const messages = assistant ? [...prev.messages, assistant] : prev.messages;
      const turns = prev.turns.map((turn, index) =>
        index === prev.turns.length - 1 && turn.status === 'streaming'
          ? {
              ...turn,
              status: assistant?.status ?? 'done',
              runId: state.runId ?? turn.runId,
              durationMs: assistant?.durationMs,
              usage: state.usage,
              steps: state.steps,
              error: state.error ?? undefined,
            }
          : turn
      );
      return { ...prev, messages, turns };
    });
    run.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const send = useCallback(
    (
      text?: string,
      files?: { imageAssets?: StoredImageAsset[]; attachments?: StoredAttachment[] }
    ) => {
      const question = (text ?? input).trim();
      if (running || !question) return;
      const composition = session.composition;
      const threadId = uid('dbg');

      const userMessage: StoredMessage = {
        id: uid('msg'),
        role: 'user',
        content: question,
        composition,
        imageAssets: files?.imageAssets,
        attachments: files?.attachments,
        createdAt: Date.now(),
      };
      const turn: DebugTurnLog = {
        id: threadId,
        at: Date.now(),
        composition,
        reasoning,
        status: 'streaming',
        model: composition.model || undefined,
      };
      setSession(prev => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        turns: [...prev.turns, turn],
      }));
      setInput('');
      const images = toImageRefs(files?.imageAssets ?? []);
      void run.send(question, reasoning, {
        composition,
        sessionNonce: session.nonce,
        ...(images.length > 0 ? { images } : {}),
      });
    },
    [running, input, session.composition, session.nonce, run, reasoning]
  );

  const approve = useCallback(
    (decision: ApproveDecision, extra?: ApprovalExtra) => {
      void run.approve(decision, extra);
    },
    [run]
  );

  const stop = useCallback(() => {
    void run.stop();
  }, [run]);

  const newSession = useCallback(() => {
    void run.cancel();
    setInput('');
    setSession(prev => ({
      ...newDebugSession(prev.composition),
      nonce: newSessionNonce(),
    }));
  }, [run]);

  /**
   * 更新组合。
   *
   * 组合变化意味着服务端的会话桶也要换：配置被替换了，上一轮的上下文不再
   * 描述这一轮。调用方在已有消息时先确认；运行中禁止调用。
   */
  const updateComposition = useCallback(
    (next: AgentComposition): boolean => {
      if (running) return false;
      const normalized = normalizeComposition(next);
      if (compositionHash(normalized) === compositionHash(session.composition)) return true;
      void run.cancel();
      setSession(prev => ({
        ...prev,
        composition: normalized,
        nonce: newSessionNonce(),
        messages: [],
        turns: [],
      }));
      return true;
    },
    [running, run, session.composition]
  );

  const retry = useCallback(
    (messageId: string) => {
      if (running) return;
      const index = session.messages.findIndex(message => message.id === messageId);
      if (index < 0) return;
      let question = '';
      let composition = session.composition;
      let imageAssets: StoredImageAsset[] | undefined;
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const candidate = session.messages[cursor];
        if (candidate?.role === 'user') {
          question = candidate.content;
          composition = candidate.composition ?? composition;
          imageAssets = candidate.imageAssets;
          break;
        }
      }
      if (!question) return;
      // A retry of a message sent under a different composition would describe
      // a run the person is no longer looking at. Only retry under the current
      // one; otherwise the caller can resend manually.
      if (compositionHash(composition) !== compositionHash(session.composition)) return;
      setSession(prev => ({
        ...prev,
        messages: prev.messages.filter(message => message.id !== messageId),
      }));
      const images = toImageRefs(imageAssets ?? []);
      void run.send(question, reasoning, {
        composition: session.composition,
        sessionNonce: session.nonce,
        ...(images.length > 0 ? { images } : {}),
      });
    },
    [running, session.messages, session.composition, session.nonce, reasoning, run]
  );

  const emptySelection = isCompositionEmpty(session.composition);

  return {
    session,
    input,
    setInput,
    reasoning,
    setReasoning,
    run,
    status,
    running,
    emptySelection,
    send,
    approve,
    stop,
    newSession,
    updateComposition,
    retry,
  };
}
