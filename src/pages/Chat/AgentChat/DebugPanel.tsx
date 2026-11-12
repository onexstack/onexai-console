import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, App, Button, Input, Modal, Space, Tag } from 'antd';

import { useDefaultNamespace } from '@/components/ResourceForm/options';
import { useNamespace } from '@/runtime';
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  PlusOutlined,
  SlidersOutlined,
} from '@ant-design/icons';

import { useIsMobile } from '@/ui';
import { meDisplayName, useMe } from '@/auth/useMe';

import type { ComposerProps } from './Composer';
import { ChatPanel } from './ChatPanel';
import { ChatSplitPane } from './ChatSplitPane';
import { DebugConfig } from './DebugConfig';
import { DebugLogDrawer } from './DebugLogDrawer';
import { PanelHeader } from './PanelHeader';
import { SubpageHeader } from './SubpageHeader';
import type { DisplayMessage } from './types';
import { useDebugSession } from './useDebugSession';
import { usePendingFiles } from './usePendingFiles';
import {
  buildSmartDraftFromComposition,
  compositionHash,
  compositionSummary,
} from './debugComposition';
import { statusText } from './chatUtils';
import { suggestName } from '@/pages/ResourceForm/smartCreate/matcher';
import styles from './debug.module.scss';

const AGENT_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/**
 * 能力调试台（无宿主 playground）。
 *
 * 不需要任何智能体：执行身份是当前登录用户，组合里的模型、提示词与能力就是
 * 这一轮运行的全部配置。组合只作用于本次运行；效果满意后可带入新建智能体
 * 表单。
 */
export function DebugPanel({
  userId,
  fallbackUserName,
  agentItems,
  fullscreen,
  onToggleFullscreen,
  onClose,
}: {
  /** 真实用户 ID：执行主体、本机记录桶与模型归属过滤。 */
  userId?: string;
  /** `/v1/auth/me` 不可用时的展示名兜底（来自令牌 claims）。 */
  fallbackUserName?: string;
  /** 仅用于「创建智能体」的重名校验；不展示、不参与运行。 */
  agentItems: Record<string, unknown>[];
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { modal, message } = App.useApp();
  // 无宿主运行的引用方：页头选中的业务空间，否则部署默认空间。组合里的裸名、
  // 跨空间 grant 判定都按它来，前后端用的是同一个值。
  const selectedNamespace = useNamespace();
  const defaultNamespace = useDefaultNamespace();
  const referrer = selectedNamespace || defaultNamespace;
  const debug = useDebugSession(userId, referrer);
  const pending = usePendingFiles();
  const meQuery = useMe();
  const userName = meDisplayName(meQuery.data) || fallbackUserName;
  // 桌面默认展开能力组合；窄屏是抽屉，深链进入时不该直接盖住对话。
  const isNarrow = useIsMobile('lg');
  const [configOpen, setConfigOpen] = useState(() => !isNarrow);
  const [logOpen, setLogOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDisplayName, setCreateDisplayName] = useState('');
  const [createDescription, setCreateDescription] = useState('');

  const existingNames = useMemo(
    () => new Set(agentItems.map(item => String(item.name)).filter(Boolean)),
    [agentItems]
  );

  const messages = debug.session.messages as DisplayMessage[];

  const liveMessage: DisplayMessage | null =
    debug.status === 'idle'
      ? null
      : {
          id: `live-${debug.run.state.runId ?? debug.run.state.startedAt ?? 'run'}`,
          role: 'assistant',
          content: debug.run.state.answer,
          reasoning: debug.run.state.reasoning || undefined,
          steps: debug.run.state.steps,
          usage: debug.run.state.usage,
          images: debug.run.state.images,
          status:
            debug.status === 'error' ? 'error' : debug.status === 'stopped' ? 'stopped' : 'done',
          error: debug.run.state.error ?? undefined,
          createdAt: debug.run.state.startedAt ?? Date.now(),
          durationMs: debug.run.state.startedAt
            ? Date.now() - debug.run.state.startedAt
            : undefined,
          pending: debug.status === 'streaming' || debug.status === 'suspended',
        };

  const handleCompositionChange = useCallback(
    (next: typeof debug.session.composition) => {
      if (debug.running) return;
      if (compositionHash(next) === compositionHash(debug.session.composition)) return;
      if (debug.session.messages.length === 0) {
        debug.updateComposition(next);
        pending.clear();
        return;
      }
      modal.confirm({
        title: '组合已变更，将开始新会话',
        content:
          '上一轮的上下文属于旧组合，继续使用会误导评测。确认后将清空本机记录并开启新的服务端会话。',
        okText: '开始新会话',
        cancelText: '取消',
        // 原生全屏时只有全屏元素子树可见，portal 到 body 会被挡在外面。
        getContainer: false,
        onOk: () => {
          debug.updateComposition(next);
          pending.clear();
        },
      });
    },
    [debug, modal, pending]
  );

  const handleSend = useCallback(() => {
    if (debug.running || pending.uploading) return;
    const text = debug.input.trim();
    if (!text && pending.images.length === 0 && pending.attachments.length === 0) return;

    const content = text || '请查看我发送的内容';
    const imageAssets = pending.readyImages.flatMap(image =>
      image.assetId ? [{ assetId: image.assetId, url: image.url, name: image.name }] : []
    );
    const attachments = pending.attachments.map(attachment => ({
      name: attachment.name,
      size: attachment.size,
      mimeType: attachment.mimeType,
    }));

    debug.send(content, {
      imageAssets: imageAssets.length > 0 ? imageAssets : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    pending.clear();
  }, [debug, pending]);

  const handleNewSession = useCallback(() => {
    if (debug.session.messages.length === 0) {
      debug.newSession();
      pending.clear();
      return;
    }
    modal.confirm({
      title: '开启新会话？',
      content: '本机记录会清空，服务端会话桶也会换一个；当前组合保留。',
      okText: '新会话',
      cancelText: '取消',
      getContainer: false,
      onOk: () => {
        debug.newSession();
        pending.clear();
      },
    });
  }, [debug, modal, pending]);

  const openCreate = useCallback(() => {
    const lastQuestion = [...debug.session.messages]
      .reverse()
      .find(item => item.role === 'user')?.content;
    const name = suggestName(lastQuestion || 'debug-agent', existingNames);
    setCreateName(name);
    setCreateDisplayName(name);
    setCreateDescription('由调试台组合创建');
    setCreateOpen(true);
  }, [debug.session.messages, existingNames]);

  const submitCreate = useCallback(() => {
    const name = createName.trim();
    if (!AGENT_NAME_RE.test(name)) {
      message.error('名称需由小写字母、数字、- 和 . 组成，且以字母或数字开头/结尾');
      return;
    }
    if (existingNames.has(name)) {
      message.error(`已存在同名智能体：${name}`);
      return;
    }
    const draft = buildSmartDraftFromComposition({
      composition: debug.session.composition,
      name,
      displayName: createDisplayName.trim() || name,
      description: createDescription.trim() || '由调试台组合创建',
    });
    setCreateOpen(false);
    navigate('/agents/new', { state: { draft } });
  }, [
    createName,
    createDisplayName,
    createDescription,
    existingNames,
    debug.session.composition,
    message,
    navigate,
  ]);

  const statusTag =
    debug.running || debug.status === 'error' ? (
      <Tag color={debug.status === 'error' ? 'red' : 'blue'}>{statusText(debug.status)}</Tag>
    ) : null;

  const composer: ComposerProps = {
    agent: null,
    draft: debug.input,
    onDraftChange: debug.setInput,
    reasoning: debug.reasoning,
    onReasoningChange: debug.setReasoning,
    status: debug.status,
    images: pending.images,
    attachments: pending.attachments,
    uploading: pending.uploading,
    onPickImages: pending.addImages,
    onRemoveImage: pending.removeImage,
    onPickAttachments: pending.addAttachments,
    onRemoveAttachment: pending.removeAttachment,
    onSend: handleSend,
    onStop: debug.stop,
    onNewThread: handleNewSession,
    allowAttachments: true,
    allowDebug: false,
    requireAgent: false,
    showSettings: false,
    showHistory: false,
  };

  const notice = (
    <div className={styles.notice}>
      <span className={styles.noticeStrong}>调试组合</span>
      <span>
        只作用于本次运行，不会修改任何智能体；执行身份、配额与审批下限来自当前登录用户与部署配置；
        模型未指定时使用部署默认。
      </span>
    </div>
  );

  const emptyState = (
    <div className={styles.empty}>
      <span className={styles.emptyTitle}>先选能力，再提问</span>
      <span>
        在右侧选择模型、提示词与能力，然后发送一个真实任务。组合变更或点「新会话」会开启新的服务端会话。
      </span>
      <span>执行身份：{userName || userId || '当前登录用户'}；模型未指定时使用部署默认。</span>
      {debug.emptySelection ? <span>当前组合为空：本轮使用部署默认模型与内置工具。</span> : null}
    </div>
  );

  return (
    <div className={styles.panel} role="region" aria-label="调试台">
      <PanelHeader
        title="调试台"
        closeLabel="返回对话"
        closeIcon={<ArrowLeftOutlined />}
        extra={
          <Space size={4}>
            {statusTag}
            <Button
              type="text"
              size="small"
              icon={<SlidersOutlined />}
              onClick={() => setConfigOpen(value => !value)}
              aria-expanded={configOpen}
              aria-controls={configOpen ? 'debug-composition-pane' : undefined}
              title={configOpen ? '收起能力组合' : '展开能力组合'}
            >
              组合
            </Button>
            <Button
              type="text"
              size="small"
              icon={<FileTextOutlined />}
              onClick={() => setLogOpen(true)}
              aria-label="打开调试日志"
            >
              日志
            </Button>
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={openCreate}
              disabled={debug.running}
            >
              创建智能体
            </Button>
          </Space>
        }
        fullscreen={fullscreen}
        onToggleFullscreen={onToggleFullscreen}
        onClose={onClose}
      />

      <ChatSplitPane
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        sideLabel="能力组合"
        sideId="debug-composition-pane"
        storageKey="onexai-console_debug_side_width"
        defaultWidth={400}
        side={
          <div className={styles.sidePane}>
            <SubpageHeader
              title="能力组合"
              closeLabel="收起能力组合"
              onClose={() => setConfigOpen(false)}
            />
            <div className={styles.sideSummary}>
              {compositionSummary(debug.session.composition)}
            </div>
            <div className={styles.sideBody}>
              <DebugConfig
                userId={userId}
                userName={userName}
                composition={debug.session.composition}
                onChange={handleCompositionChange}
                disabled={debug.running}
              />
            </div>
          </div>
        }
      >
        <div className={styles.main}>
          <ChatPanel
            threadKey={debug.session.nonce}
            messages={messages}
            liveMessage={liveMessage}
            interrupt={debug.run.state.interrupt}
            onApprove={debug.approve}
            onRetry={debug.retry}
            notice={notice}
            emptyState={emptyState}
            composer={composer}
          />
        </div>
      </ChatSplitPane>

      <DebugLogDrawer
        open={logOpen}
        onClose={() => setLogOpen(false)}
        subject={userId}
        subjectLabel={userName}
        session={debug.session}
        run={debug.run.state}
      />

      <Modal
        open={createOpen}
        title="基于当前组合创建智能体"
        okText="去创建"
        cancelText="取消"
        // 原生全屏时只有全屏元素子树可见，portal 到 body 会被挡在外面。
        getContainer={false}
        onOk={submitCreate}
        onCancel={() => setCreateOpen(false)}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            title="将打开新建智能体表单并预填当前组合"
            description="智能体将以当前登录用户身份创建；模型留空表示使用部署默认。你可以在表单里继续微调名称、提示词与能力，确认后再保存。"
          />
          <Input
            addonBefore="名称"
            value={createName}
            onChange={event => setCreateName(event.target.value)}
            placeholder="如 incident-helper"
          />
          <Input
            addonBefore="显示名"
            value={createDisplayName}
            onChange={event => setCreateDisplayName(event.target.value)}
          />
          <Input
            addonBefore="描述"
            value={createDescription}
            onChange={event => setCreateDescription(event.target.value)}
          />
        </Space>
      </Modal>
    </div>
  );
}
