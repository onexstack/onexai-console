import type { ReactNode } from 'react';

import type { ApproveDecision, DebugInterrupt } from '@/api/stream';

import { ApprovalCard } from './ApprovalCard';
import { Composer, type ComposerProps } from './Composer';
import { EmptyState } from './EmptyState';
import { MessageBubble } from './MessageBubble';
import type { ApprovalExtra, DisplayMessage } from './types';
import { useStickToBottom } from './useStickToBottom';
import styles from './styles.module.scss';

export function ChatPanel({
  threadKey,
  messages,
  liveMessage,
  agent,
  interrupt,
  onApprove,
  onRetry,
  onOpenSettings,
  notice,
  emptyState,
  composer,
}: {
  threadKey: string;
  messages: DisplayMessage[];
  liveMessage: DisplayMessage | null;
  agent?: string | null;
  interrupt: DebugInterrupt | null;
  onApprove: (decision: ApproveDecision, extra?: ApprovalExtra) => void;
  onRetry: (messageId: string) => void;
  onOpenSettings?: () => void;
  /** 固定条：测试模式等页面级状态，放在消息区上方。 */
  notice?: ReactNode;
  /** 调试台等页面自己决定空态内容；提供时替换默认的选智能体提示。 */
  emptyState?: ReactNode;
  composer: ComposerProps;
}) {
  const { scrollRef, contentRef, stuck, onScroll, jumpToLatest } = useStickToBottom(threadKey);

  const lastErrorMessage = [...messages]
    .reverse()
    .find(message => message.role === 'assistant' && message.status === 'error');
  const empty = messages.length === 0 && !liveMessage;

  return (
    <>
      {notice}

      <div
        ref={scrollRef}
        className={styles.messages}
        onScroll={onScroll}
        aria-busy={Boolean(liveMessage)}
      >
        <div ref={contentRef} className={styles.stickTrack}>
          {empty
            ? (emptyState ?? (
                <EmptyState
                  hasAgent={Boolean(agent)}
                  onOpenSettings={onOpenSettings ?? (() => undefined)}
                />
              ))
            : messages.map(message => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onRetry={
                    lastErrorMessage && message.id === lastErrorMessage.id
                      ? () => onRetry(message.id)
                      : undefined
                  }
                />
              ))}

          {liveMessage && <MessageBubble message={liveMessage} />}

          {interrupt && <ApprovalCard interrupt={interrupt} onApprove={onApprove} />}
        </div>
      </div>

      <Composer {...composer} showJumpToLatest={!stuck} onJumpToLatest={jumpToLatest} />
    </>
  );
}
