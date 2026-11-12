import { memo } from 'react';
import { Button } from 'antd';
import { LoadingOutlined, PaperClipOutlined, ReloadOutlined } from '@ant-design/icons';

import type { DebugStep } from '@/api/stream';
import AuthImage from '@/components/AuthImage';
import CopyButton from '@/ui/components/CopyButton';
import MarkdownViewer from '@/ui/components/MarkdownViewer';

import { formatBytes, formatDuration, formatTime, formatTokens } from './chatUtils';
import { compositionSummary } from './debugComposition';
import { ReasoningBlock } from './ReasoningBlock';
import { SparkleIcon } from '@/ui';
import type { DisplayMessage } from './types';
import { useThrottledValue } from './useThrottledValue';
import styles from './bubble.module.scss';

/**
 * 一条消息。已存消息与正在流式生成的消息共用这一个组件：
 * `pending` 决定思考块标题、Markdown 节流与「正在生成」。
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  onRetry,
}: {
  message: DisplayMessage;
  onRetry?: () => void;
}) {
  const isUser = message.role === 'user';
  const throttled = useThrottledValue(message.content, 100);
  const content = message.pending ? throttled : message.content;
  const duration = formatDuration(message.durationMs);
  const tokens = formatTokens(message.usage);
  const thinking = Boolean(message.pending) && !message.content;

  return (
    <div className={`${styles.row} ${isUser ? styles.mine : ''}`}>
      <span className={`${styles.avatar} ${isUser ? styles.avatarMine : ''}`}>
        {isUser ? <span className={styles.avatarText}>我</span> : <SparkleIcon size={13} />}
      </span>

      <div className={styles.wrapper}>
        <div className={styles.bubble}>
          {!isUser && message.reasoning && (
            <ReasoningBlock reasoning={message.reasoning} thinking={thinking} />
          )}

          {!isUser && message.steps && message.steps.length > 0 && (
            <StepList steps={message.steps} />
          )}

          {message.imageAssets && message.imageAssets.length > 0 && (
            <div className={styles.images}>
              {message.imageAssets.map(asset => (
                <AuthImage
                  key={asset.assetId}
                  assetId={asset.assetId}
                  alt={asset.name}
                  width={140}
                />
              ))}
            </div>
          )}

          {message.images && message.images.length > 0 && (
            <div className={styles.images}>
              {message.images.map(image => (
                <AuthImage key={image} assetId={image} src={image} width={140} />
              ))}
            </div>
          )}

          {message.attachments && message.attachments.length > 0 && (
            <div className={styles.attachments}>
              {message.attachments.map((attachment, index) => (
                <span
                  key={`${attachment.name}-${index}`}
                  className={styles.attachment}
                  title={attachment.name}
                >
                  <PaperClipOutlined />
                  <span className={styles.attachmentName}>{attachment.name}</span>
                  <em>{formatBytes(attachment.size)}</em>
                </span>
              ))}
            </div>
          )}

          {isUser && message.testMode && (
            <span
              className="mb-1 inline-block rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]"
              title={
                message.capabilities
                  ? `本次运行使用：Skill ${message.capabilities.skills.length} · MCP ${message.capabilities.mcps.length} · 知识库 ${message.capabilities.knowledgeBases.length} · 自定义命令 ${message.capabilities.customCommands.length}`
                  : '本次运行使用生效能力全集'
              }
            >
              测试模式{message.capabilities ? ' · 已缩小' : ''}
            </span>
          )}

          {isUser && message.composition && (
            <span
              className="mb-1 inline-block rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]"
              title={compositionSummary(message.composition)}
            >
              调试组合
            </span>
          )}

          {isUser ? (
            <div className={styles.userText}>{message.content}</div>
          ) : message.content ? (
            <MarkdownViewer value={content} className={styles.markdown} />
          ) : message.pending ? (
            <LoadingOutlined className={styles.pendingIcon} />
          ) : null}

          {message.error && <div className={styles.error}>{message.error}</div>}

          {message.status === 'stopped' && <div className={styles.note}>已停止</div>}

          {message.status === 'error' && onRetry && (
            <div className={styles.retry}>
              <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
                重试
              </Button>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {!isUser && (
            <span className={styles.usage}>
              {message.pending
                ? '正在生成…'
                : [duration ? `耗时 ${duration}` : null, tokens].filter(Boolean).join(' · ')}
            </span>
          )}
          <div className={styles.actions}>
            <span className={styles.time}>{formatTime(message.createdAt)}</span>
            {message.content && (
              <CopyButton
                value={message.content}
                size="small"
                type="text"
                ariaLabel={isUser ? '复制消息' : '复制回答'}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

function StepList({ steps }: { steps: DebugStep[] }) {
  return (
    <div className={styles.steps}>
      <div className={styles.stepsTitle}>工具步骤</div>
      {steps.map((step, index) => (
        <div key={step.id ?? `${step.name}-${index}`} className={styles.step}>
          <span
            className={
              step.status === 'fail'
                ? styles.stepFailed
                : step.status === 'ok'
                  ? styles.stepOk
                  : undefined
            }
          >
            {step.status === 'fail' ? '✗' : step.status === 'ok' ? '✓' : '·'}
          </span>
          <span className={styles.stepName}>{step.name || '工具'}</span>
          {step.durationMs ? <span>{step.durationMs}ms</span> : null}
          {step.tokens ? <span>{step.tokens} tokens</span> : null}
        </div>
      ))}
    </div>
  );
}
