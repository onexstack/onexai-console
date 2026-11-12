import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { getEffectiveAgent, platformBinding } from '@/api/agent';
import type { ApproveDecision } from '@/api/stream';
import type { CapabilitySelection, SelectableCapability } from '@/api/types';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import { normalizeOptionDescription } from '@/components/OptionLabel/helpers';
import { useGoBack } from '@/runtime';

import {
  emptySelection,
  fullSelection,
  isNarrowed,
  selectionCounts,
  toRequestSelection,
} from '../capabilities';
import {
  loadThreads,
  newThread,
  saveThreads,
  titleFrom,
  type ChatThread,
  type StoredMessage,
} from '../transcriptStore';
import { useAgentRun } from '../useAgentRun';
import { ChatPanel } from './ChatPanel';
import { ChatSplitPane } from './ChatSplitPane';
import {
  LAST_AGENT_KEY,
  PANEL_TITLE,
  REASONING_KEY,
  statusText,
  toImageRefs,
  uid,
} from './chatUtils';
import { DebugPanel } from './DebugPanel';
import { HistoryPanel } from './HistoryPanel';
import { PanelHeader } from './PanelHeader';
import { SettingsPanel } from './SettingsPanel';
import type { AgentChatView, AgentOption, ApprovalExtra, DisplayMessage } from './types';
import { usePendingFiles } from './usePendingFiles';
import styles from './styles.module.scss';

/**
 * 外部 A2A 智能体在没有卡片、且没有上一张好卡片时（phase=Error），这一轮
 * 必然发不出去。选它只会换来一次发送失败，所以在选择器里直接停用。
 */
function cardUnavailable(item: Record<string, unknown>): boolean {
  if (item.kind !== 'external') return false;
  const a2a = item.a2a as { phase?: string } | undefined;
  return a2a?.phase === 'Error';
}

/**
 * 智能体直聊（参考 OneX 智能体面板的整页单栏版本）。
 *
 * 数据链路不变：运行面（管理员 `/v1/admin/agent/ask`、普通用户
 * `/v1/user/agent/ask`）流式运行 + 本机 transcript store。
 * 左侧线程栏改成「历史」子视图，右侧能力检查器改成「设置」子视图。
 */
export default function AgentChat({
  initialAgent,
  draft,
}: {
  initialAgent?: string;
  draft?: string;
}) {
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const userId = claims?.userId;
  const goBack = useGoBack('/workbench');

  const agentsQuery = useQuery({
    queryKey: ['res', 'agents', 'picker'],
    queryFn: () => platformBinding('agents').api.list({ page: 1, pageSize: 100 }),
    staleTime: 60_000,
  });
  const agentItems = useMemo(() => agentsQuery.data?.items ?? [], [agentsQuery.data]);

  /**
   * 选择值：同名 Agent 跨空间存在时用 `空间/名称`，唯一时保留裸名。
   *
   * 裸名在后端按“唯一匹配”解析；同名多份时它会明确报歧义，而不是跑错租户。
   * 这里把限定名作为选择值，让用户能明确选中其中一个。
   */
  const agentRefOf = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of agentItems) {
      const name = String(item.name ?? '');
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return (item: Record<string, unknown>): string => {
      const name = String(item.name ?? '');
      const namespace = typeof item.namespace === 'string' ? item.namespace : '';
      return namespace && (counts.get(name) ?? 0) > 1 ? `${namespace}/${name}` : name;
    };
  }, [agentItems]);

  const [agent, setAgent] = useState<string>(() => {
    try {
      return initialAgent || localStorage.getItem(LAST_AGENT_KEY) || '';
    } catch {
      return initialAgent ?? '';
    }
  });

  const selectedAgentItem = useMemo(
    () => agentItems.find(item => agentRefOf(item) === agent),
    [agent, agentItems, agentRefOf]
  );
  // 外部 A2A 智能体没有平台提示词、模型、工具和能力：这一轮整体交给对端，
  // 所以测试模式、调试台、图片与附件都不适用（消息只发送文本）。
  const isExternalAgent = selectedAgentItem?.kind === 'external';

  // 没有指定智能体、或上次记住的智能体已被删除/改名时，落到第一个启用的。
  // 优先平台智能体：外部 A2A 智能体要把这一轮发给对端，不该成为默认目标。
  useEffect(() => {
    if (!agentsQuery.isSuccess) return;
    if (agentItems.length === 0) {
      if (agent) setAgent('');
      return;
    }
    const available = agentItems.map(item => agentRefOf(item));
    if (agent && available.includes(agent)) return;
    const usable = agentItems.filter(item => item.status !== 'disabled' && !cardUnavailable(item));
    const first = usable.find(item => item.kind !== 'external') ?? usable[0] ?? agentItems[0];
    if (first) setAgent(agentRefOf(first));
  }, [agent, agentItems, agentsQuery.isSuccess, agentRefOf]);

  useEffect(() => {
    if (!agent) return;
    try {
      localStorage.setItem(LAST_AGENT_KEY, agent);
    } catch {
      // 隐私模式：记住上次选择只是便利。
    }
  }, [agent]);

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<AgentChatView>(() =>
    searchParams.get('view') === 'debug' ? 'debug' : 'chat'
  );

  /** 视图切换的唯一入口：调试台用 `?view=debug` 直达，其余视图不写 URL。 */
  const setViewParam = useCallback(
    (next: AgentChatView) => {
      setView(next);
      setSearchParams(
        prev => {
          const params = new URLSearchParams(prev);
          if (next === 'debug') params.set('view', 'debug');
          else params.delete('view');
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const [input, setInput] = useState(draft ?? '');
  const [reasoning, setReasoning] = useState(() => {
    try {
      return localStorage.getItem(REASONING_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [selection, setSelection] = useState<CapabilitySelection>(() => emptySelection());
  const [resetNote, setResetNote] = useState(false);

  // 外部 A2A 智能体由对端执行：没有能力可以收窄。切到它时退出测试模式；调试台
  // 已无宿主，因此不再把 `?view=debug` 强制退回聊天。
  useEffect(() => {
    if (!isExternalAgent) return;
    if (testMode) setTestMode(false);
  }, [isExternalAgent, testMode]);

  const loadedAgentRef = useRef('');
  const runThreadRef = useRef('');
  const finalizedRef = useRef('');
  const panelRef = useRef<HTMLDivElement>(null);
  const effectiveKeyRef = useRef('');

  const run = useAgentRun(agent || null);
  const pending = usePendingFiles();
  const { clear: clearPending } = pending;

  // 外部 A2A 智能体只发文本：切到它时丢掉待发送的图片/附件，避免它们显示为
  // 已附加、实际却不会被发送。
  useEffect(() => {
    if (isExternalAgent) clearPending();
  }, [isExternalAgent, clearPending]);

  useEffect(() => {
    try {
      localStorage.setItem(REASONING_KEY, reasoning ? '1' : '0');
    } catch {
      // 同上：偏好写不进去不影响发送。
    }
  }, [reasoning]);

  // 切换智能体：先放弃在飞的运行，再加载该 (管理员 × 智能体) 桶的本机线程。
  useEffect(() => {
    if (!agent) return;
    void run.cancel();
    pending.clear();
    const loaded = loadThreads(userId, agent);
    setThreads(loaded);
    setActiveId(loaded[0]?.id ?? '');
    loadedAgentRef.current = agent;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, userId]);

  // 只在「当前智能体已加载」后写回，避免首帧把存储里的线程覆盖成空数组。
  useEffect(() => {
    if (!agent || loadedAgentRef.current !== agent) return;
    saveThreads(userId, agent, threads);
  }, [threads, agent, userId]);

  // 一次运行结束后，把结果落进本机线程。
  useEffect(() => {
    const state = run.state;
    if (!['done', 'stopped', 'error'].includes(state.status)) return;
    const key = state.runId ?? String(state.startedAt ?? '');
    if (finalizedRef.current === key) return;
    finalizedRef.current = key;

    const threadId = runThreadRef.current;
    if (threadId && (state.answer || state.error)) {
      const message: StoredMessage = {
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
      };
      setThreads(prev =>
        prev.map(thread =>
          thread.id === threadId
            ? {
                ...thread,
                updatedAt: Date.now(),
                messages: [...thread.messages, message],
              }
            : thread
        )
      );
    }
    run.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.state.status]);

  const activeThread = threads.find(thread => thread.id === activeId);
  const messages = activeThread?.messages ?? [];
  const running = run.state.status === 'streaming' || run.state.status === 'suspended';

  const effectiveQuery = useQuery({
    queryKey: ['agent', agent, 'effective'],
    queryFn: () => getEffectiveAgent(agent),
    enabled: Boolean(agent),
    staleTime: 30_000,
    retry: false,
  });

  const capabilities = effectiveQuery.data?.capabilities;
  // 测试模式开着但能力数据不在了（例如查询失败后缓存被清）：不能退回全集发送，
  // 那等于把用户以为已经收窄的一轮悄悄放宽。
  const testModeBlocked = testMode && !capabilities;
  const narrowed = useMemo(() => isNarrowed(selection, capabilities), [selection, capabilities]);
  const counts = useMemo(() => selectionCounts(selection, capabilities), [selection, capabilities]);

  // 选择在「进入测试模式」与「切换智能体 / 生效能力真正变化」时重置。
  // 用 resolvedHash 作为键：后台 refetch 返回同一份数据时 TanStack 会做结构
  // 共享，capabilities 引用不变，这里也不会触发；只有控制器重新解析过才重置。
  useEffect(() => {
    if (!capabilities) return;
    const key = `${agent}::${effectiveQuery.data?.resolvedHash ?? ''}`;
    if (effectiveKeyRef.current === key) return;
    const first = effectiveKeyRef.current === '';
    effectiveKeyRef.current = key;
    setSelection(fullSelection(capabilities));
    setResetNote(!first && testMode);
  }, [agent, capabilities, effectiveQuery.data?.resolvedHash, testMode]);

  const handleTestModeChange = (next: boolean) => {
    setTestMode(next);
    setResetNote(false);
    if (!next) return;
    setSelection(fullSelection(capabilities));
    // 选择器在设置子页；从输入框的「测试」直接打开，省掉「开了但找不到怎么选」。
    setViewParam('settings');
  };

  const handleSelectionChange = (kind: SelectableCapability, names: string[]) => {
    setSelection(prev => ({ ...prev, [kind]: names }));
  };

  const liveMessage: DisplayMessage | null =
    run.state.status === 'idle'
      ? null
      : {
          id: `live-${run.state.runId ?? run.state.startedAt ?? 'run'}`,
          role: 'assistant',
          content: run.state.answer,
          reasoning: run.state.reasoning || undefined,
          steps: run.state.steps,
          usage: run.state.usage,
          images: run.state.images,
          status:
            run.state.status === 'error'
              ? 'error'
              : run.state.status === 'stopped'
                ? 'stopped'
                : 'done',
          error: run.state.error ?? undefined,
          createdAt: run.state.startedAt ?? Date.now(),
          durationMs: run.state.startedAt ? Date.now() - run.state.startedAt : undefined,
          pending: run.state.status === 'streaming' || run.state.status === 'suspended',
        };

  const appendMessage = useCallback((threadId: string, message: StoredMessage) => {
    setThreads(prev =>
      prev.map(thread =>
        thread.id === threadId
          ? {
              ...thread,
              updatedAt: Date.now(),
              title:
                thread.title === '新对话' ? titleFrom([...thread.messages, message]) : thread.title,
              messages: [...thread.messages, message],
            }
          : thread
      )
    );
  }, []);

  const ensureThread = useCallback((): string => {
    const existing = threads.find(thread => thread.id === activeId);
    if (existing) return existing.id;
    const created = newThread(agent);
    setThreads(prev => [created, ...prev]);
    setActiveId(created.id);
    return created.id;
  }, [threads, activeId, agent]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!agent || running || pending.uploading || testModeBlocked) return;
    if (!text && pending.images.length === 0 && pending.attachments.length === 0) return;

    const content = text || '请查看我发送的内容';
    const threadId = ensureThread();
    runThreadRef.current = threadId;

    const imageAssets = pending.readyImages.flatMap(image =>
      image.assetId ? [{ assetId: image.assetId, url: image.url, name: image.name }] : []
    );
    const attachments = pending.attachments.map(attachment => ({
      name: attachment.name,
      size: attachment.size,
      mimeType: attachment.mimeType,
    }));

    // 只有真的比生效能力更窄时才发送 capabilities：全选等于全集，少发一份
    // 列表就少一次「UI 看到的能力和后端刚解析出的能力不一致」的机会。
    const requestCapabilities =
      testMode && narrowed && capabilities ? toRequestSelection(selection) : undefined;

    appendMessage(threadId, {
      id: uid('msg'),
      role: 'user',
      content,
      imageAssets: imageAssets.length > 0 ? imageAssets : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      testMode: testMode || undefined,
      capabilities: requestCapabilities,
      createdAt: Date.now(),
    });

    const images = toImageRefs(imageAssets);
    setInput('');
    pending.clear();
    const extras =
      images.length > 0 || requestCapabilities
        ? {
            ...(images.length > 0 ? { images } : {}),
            ...(requestCapabilities ? { capabilities: requestCapabilities } : {}),
          }
        : undefined;
    void run.send(content, reasoning, extras);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    input,
    agent,
    running,
    pending,
    ensureThread,
    appendMessage,
    reasoning,
    run.send,
    testMode,
    testModeBlocked,
    narrowed,
    capabilities,
    selection,
  ]);

  const handleRetry = useCallback(
    (messageId: string) => {
      if (!agent || running) return;
      const thread = threads.find(item => item.id === activeId);
      if (!thread) return;
      const index = thread.messages.findIndex(message => message.id === messageId);
      if (index < 0) return;

      let userMessage: StoredMessage | undefined;
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const candidate = thread.messages[cursor];
        if (candidate?.role === 'user') {
          userMessage = candidate;
          break;
        }
      }
      if (!userMessage) return;

      setThreads(prev =>
        prev.map(item =>
          item.id === thread.id
            ? { ...item, messages: item.messages.filter(message => message.id !== messageId) }
            : item
        )
      );

      runThreadRef.current = thread.id;
      const images = toImageRefs(userMessage.imageAssets ?? []);
      // 重试复现的是那条消息发出时的能力集合，不是当前面板上的选择：用户可能
      // 已经改过勾选，而「重试」的语义是把这一轮再跑一遍。
      const extras =
        images.length > 0 || userMessage.capabilities
          ? {
              ...(images.length > 0 ? { images } : {}),
              ...(userMessage.capabilities ? { capabilities: userMessage.capabilities } : {}),
            }
          : undefined;
      void run.send(userMessage.content, reasoning, extras);
    },
    [agent, running, threads, activeId, reasoning, run]
  );

  const handleNewThread = useCallback(() => {
    if (!agent) return;
    void run.cancel();
    pending.clear();
    const created = newThread(agent);
    setThreads(prev => [created, ...prev]);
    setActiveId(created.id);
    setViewParam('chat');
  }, [agent, pending, run, setViewParam]);

  const handleSelectThread = useCallback(
    (id: string) => {
      if (id !== activeId) {
        void run.cancel();
        setActiveId(id);
      }
      setViewParam('chat');
    },
    [activeId, run, setViewParam]
  );

  const handleRenameThread = useCallback((id: string, title: string) => {
    setThreads(prev => prev.map(thread => (thread.id === id ? { ...thread, title } : thread)));
  }, []);

  const handleDeleteThread = useCallback(
    (id: string) => {
      // 只有删当前会话才需要放弃在飞的那一轮；删历史里的旧会话不该打断当前回答。
      if (id === activeId) void run.cancel();
      const next = threads.filter(thread => thread.id !== id);
      setThreads(next);
      if (id === activeId) setActiveId(next[0]?.id ?? '');
    },
    [activeId, run, threads]
  );

  const handleClearThreads = useCallback(() => {
    void run.cancel();
    setThreads([]);
    setActiveId('');
    saveThreads(userId, agent, []);
  }, [agent, run, userId]);

  const handleApprove = useCallback(
    (decision: ApproveDecision, extra?: ApprovalExtra) => {
      void run.approve(decision, extra);
    },
    [run]
  );

  const handleClose = useCallback(() => {
    void run.cancel();
    setPseudoFullscreen(false);
    goBack();
  }, [goBack, run]);

  const handleOpenDebug = useCallback(() => {
    // 调试台有自己的运行实例；放弃聊天里在飞的一轮，避免两个流同时计费。
    void run.cancel();
    pending.clear();
    setViewParam('debug');
  }, [run, pending, setViewParam]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === panelRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // 退出失败时保持现状。
      }
      return;
    }
    try {
      await panelRef.current?.requestFullscreen();
    } catch {
      // iframe / 宿主未授予 fullscreen 权限：退化为 CSS 覆盖层。
      setPseudoFullscreen(value => !value);
    }
  }, []);

  useEffect(() => {
    if (!pseudoFullscreen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPseudoFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pseudoFullscreen]);

  const agentOptions: AgentOption[] = agentItems.map(item => {
    const unavailable = cardUnavailable(item);
    const name = String(item.name);
    const value = agentRefOf(item);
    // 同名跨空间时选择值就是限定名，标签直接用它，避免两个同名项看起来一样。
    const title = value !== name ? value : item.displayName || name;
    return {
      value,
      label: `${title}${item.kind === 'external' ? '（A2A）' : ''}${
        unavailable ? '（卡片未同步）' : ''
      }${item.status === 'disabled' ? '（停用）' : ''}`,
      description: normalizeOptionDescription(item.description),
      disabled: item.status === 'disabled' || unavailable,
      external: item.kind === 'external',
    };
  });
  const agentLabel =
    agentOptions.find(option => option.value === agent)?.label ?? agent ?? '未选择智能体';

  const composer = {
    agent: agent || null,
    draft: input,
    onDraftChange: setInput,
    reasoning,
    onReasoningChange: setReasoning,
    status: run.state.status,
    images: pending.images,
    attachments: pending.attachments,
    uploading: pending.uploading,
    onPickImages: pending.addImages,
    onRemoveImage: pending.removeImage,
    onPickAttachments: pending.addAttachments,
    onRemoveAttachment: pending.removeAttachment,
    onSend: handleSend,
    onStop: () => void run.stop(),
    // 设置/历史停靠在右侧：再点一次同一个入口即收起。
    onOpenSettings: () => setViewParam(view === 'settings' ? 'chat' : 'settings'),
    onOpenDebug: handleOpenDebug,
    // 外部 A2A 智能体的消息只发送文本，能力/模型由对端决定，所以图片和附件
    // 不该看起来能发出去。调试台已无宿主，对所有智能体都可进入。
    allowAttachments: !isExternalAgent,
    allowDebug: true,
    onOpenHistory: () => {
      pending.clear();
      setViewParam(view === 'history' ? 'chat' : 'history');
    },
    onNewThread: handleNewThread,
    showJumpToLatest: false,
    onJumpToLatest: () => undefined,
  };

  const testNotice = testMode ? (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] px-4 py-1.5 text-[12px] text-[var(--color-text-secondary)]">
      <span>
        {testModeBlocked ? (
          <span className="text-[var(--color-warning)]">
            无法读取生效能力，测试模式已暂停发送；请退出测试模式后重试。
          </span>
        ) : (
          <>
            测试模式：本次运行只启用所选能力（已选 {counts.selected}/{counts.total}
            {narrowed ? '，已缩小' : '，等同生效能力'}）。
          </>
        )}
      </span>
      <Button type="link" size="small" onClick={() => setTestMode(false)}>
        退出
      </Button>
    </div>
  ) : null;

  // 外部 A2A 智能体这一轮整体交给对端：说清楚消息如何到达、什么内容会发送，
  // 比让用户猜测「为什么没有能力面板/调试台/图片按钮」更省事。
  const externalNotice = isExternalAgent ? (
    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] px-4 py-1.5 text-[12px] text-[var(--color-text-secondary)]">
      <span>
        外部 A2A 智能体：消息将直接发送给对端 Agent（仅文本），回复、任务状态与能力由对端提供。
      </span>
    </div>
  ) : null;

  return (
    <div
      ref={panelRef}
      className={`${styles.panel} ${pseudoFullscreen ? styles.panelPseudoFullscreen : ''}`}
      role="region"
      aria-label={view === 'debug' ? '调试台' : PANEL_TITLE}
    >
      {/* 调试台是整页替换：它自己渲染唯一的一级页头，聊天页头不再出现。 */}
      {view !== 'debug' && (
        <PanelHeader
          agentLabel={agentLabel}
          fullscreen={fullscreen || pseudoFullscreen}
          onToggleFullscreen={() => void toggleFullscreen()}
          onClose={handleClose}
        />
      )}

      <div className={styles.body}>
        {view === 'debug' ? (
          <DebugPanel
            key="debug-hostless"
            userId={userId}
            fallbackUserName={claims?.name}
            agentItems={agentItems as Record<string, unknown>[]}
            fullscreen={fullscreen || pseudoFullscreen}
            onToggleFullscreen={() => void toggleFullscreen()}
            onClose={() => setViewParam('chat')}
          />
        ) : (
          // 设置/历史停靠在右侧：中间的对话保持挂载，关闭面板即回到单栏。
          <ChatSplitPane
            open={view === 'settings' || view === 'history'}
            onClose={() => setViewParam('chat')}
            sideLabel={view === 'history' ? '聊天历史' : '智能体设置'}
            sideId="chat-side-pane"
            storageKey="onexai-console_chat_side_width"
            defaultWidth={400}
            side={
              view === 'settings' ? (
                <SettingsPanel
                  agents={agentOptions}
                  agentsLoading={agentsQuery.isLoading}
                  agent={agent}
                  onAgentChange={setAgent}
                  reasoning={reasoning}
                  onReasoningChange={setReasoning}
                  effective={effectiveQuery.data}
                  effectiveLoading={effectiveQuery.isLoading}
                  effectiveError={effectiveQuery.isError}
                  testMode={testMode}
                  onTestModeChange={handleTestModeChange}
                  selection={selection}
                  onSelectionChange={handleSelectionChange}
                  onSelectAll={() => {
                    setSelection(fullSelection(capabilities));
                    setResetNote(false);
                  }}
                  onClearAll={() => {
                    setSelection(emptySelection());
                    setResetNote(false);
                  }}
                  onRestore={() => {
                    setSelection(fullSelection(capabilities));
                    setResetNote(false);
                  }}
                  resetNote={resetNote}
                  external={isExternalAgent}
                  closeLabel="收起"
                  onClose={() => setViewParam('chat')}
                />
              ) : view === 'history' ? (
                <HistoryPanel
                  threads={threads}
                  activeId={activeId}
                  running={running}
                  onSelect={handleSelectThread}
                  onRename={handleRenameThread}
                  onDelete={handleDeleteThread}
                  onClear={handleClearThreads}
                  closeLabel="收起"
                  onClose={() => setViewParam('chat')}
                />
              ) : null
            }
          >
            <ChatPanel
              threadKey={activeId || 'new'}
              messages={messages}
              liveMessage={liveMessage}
              agent={agent || null}
              interrupt={run.state.interrupt}
              onApprove={handleApprove}
              onRetry={handleRetry}
              onOpenSettings={() => setViewParam('settings')}
              notice={testNotice ?? externalNotice}
              composer={composer}
            />
          </ChatSplitPane>
        )}
      </div>

      <span className={styles.srOnly} role="status">
        {statusText(run.state.status)}
      </span>
    </div>
  );
}
