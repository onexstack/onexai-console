import {
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Input } from 'antd';
import {
  BulbOutlined,
  ClockCircleOutlined,
  ExperimentOutlined,
  PaperClipOutlined,
  PictureOutlined,
  PlusOutlined,
  SettingOutlined,
  StopOutlined,
} from '@ant-design/icons';

import { CHAT_LIMITS } from './chatUtils';
import { JumpToLatest } from './JumpToLatest';
import { PendingAttachmentStrip, PendingImageStrip } from './PendingStrips';
import type { PendingAttachment, PendingImage } from './types';
import styles from './styles.module.scss';

export interface ComposerProps {
  agent: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  reasoning: boolean;
  onReasoningChange: (next: boolean) => void;
  status: 'idle' | 'streaming' | 'suspended' | 'done' | 'stopped' | 'error';
  images: PendingImage[];
  attachments: PendingAttachment[];
  uploading: boolean;
  onPickImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
  onPickAttachments: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onSend: () => void;
  onStop: () => void;
  onOpenSettings?: () => void;
  onOpenDebug?: () => void;
  /** 外部 A2A 智能体只收文本：隐藏图片/附件入口并忽略拖拽与粘贴。 */
  allowAttachments: boolean;
  /** 外部 A2A 智能体没有平台调试台；调试台自身也不显示这个入口。 */
  allowDebug: boolean;
  onOpenHistory?: () => void;
  onNewThread: () => void;
  /** 调试台没有 agent 也能发送：由调用方决定是否要求 agent。 */
  requireAgent?: boolean;
  /** 调试台不展示设置/历史入口。 */
  showSettings?: boolean;
  showHistory?: boolean;
  showJumpToLatest?: boolean;
  onJumpToLatest?: () => void;
}

export function Composer({
  agent,
  draft,
  onDraftChange,
  reasoning,
  onReasoningChange,
  status,
  images,
  attachments,
  uploading,
  onPickImages,
  onRemoveImage,
  onPickAttachments,
  onRemoveAttachment,
  onSend,
  onStop,
  onOpenSettings,
  onOpenDebug,
  allowAttachments,
  allowDebug,
  onOpenHistory,
  onNewThread,
  requireAgent = true,
  showSettings = true,
  showHistory = true,
  showJumpToLatest = false,
  onJumpToLatest,
}: ComposerProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [dragDepth, setDragDepth] = useState(0);

  const running = status === 'streaming' || status === 'suspended';
  const suspended = status === 'suspended';
  const charCount = draft.length;
  const canSend =
    (!requireAgent || Boolean(agent)) &&
    !running &&
    !uploading &&
    (draft.trim().length > 0 || images.length > 0 || attachments.length > 0);

  const holdFocus = (event: ReactMouseEvent) => event.preventDefault();

  const hasFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer.items ?? []).some(item => item.kind === 'file');

  const handleDragEnter = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDragDepth(depth => depth + 1);
  };

  const handleDragOver = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
  };

  const handleDragLeave = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDragDepth(depth => Math.max(0, depth - 1));
  };

  const handleDrop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    // The drag handlers above already made this area a drop target. Preventing
    // the default must happen before the policy check, otherwise the browser
    // navigates to the dropped file and replaces the page — losing the draft.
    event.preventDefault();
    event.stopPropagation();
    // 外部 A2A 智能体只接收文本；把文件拦在输入框，比让它显示成已附加、
    // 再在发送时被静默丢弃要好。
    if (!allowAttachments) return;
    setDragDepth(0);
    const files = Array.from(event.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    const otherFiles = files.filter(file => !file.type.startsWith('image/'));
    if (imageFiles.length > 0) onPickImages(imageFiles);
    if (otherFiles.length > 0) onPickAttachments(otherFiles);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!allowAttachments) return;
    const files = Array.from(event.clipboardData.items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file))
      .filter(file => file.type.startsWith('image/'));
    if (files.length > 0) {
      event.preventDefault();
      onPickImages(files);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div
      className={styles.inputArea}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {showJumpToLatest && onJumpToLatest && <JumpToLatest onClick={onJumpToLatest} />}

      <div className={styles.composerToolbar}>
        <div className={styles.toolbarLeft}>
          {allowAttachments && (
            <>
              <button
                type="button"
                className={styles.toolIconBtn}
                onMouseDown={holdFocus}
                onClick={() => imageInputRef.current?.click()}
                disabled={running}
                aria-label="添加图片"
                title="添加图片"
              >
                <PictureOutlined />
              </button>
              <input
                ref={imageInputRef}
                type="file"
                multiple
                hidden
                accept={CHAT_LIMITS.imageAccept}
                onChange={event => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (files.length > 0) onPickImages(files);
                }}
              />

              <button
                type="button"
                className={styles.toolIconBtn}
                onMouseDown={holdFocus}
                onClick={() => attachmentInputRef.current?.click()}
                disabled={running}
                aria-label="添加附件"
                title="添加附件（后端暂不支持上传，仅本地展示）"
              >
                <PaperClipOutlined />
              </button>
              <input
                ref={attachmentInputRef}
                type="file"
                hidden
                accept={CHAT_LIMITS.attachmentAccept}
                onChange={event => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (files.length > 0) onPickAttachments(files);
                }}
              />
            </>
          )}
        </div>

        {allowDebug && onOpenDebug && (
          <button
            type="button"
            className={styles.toolIconBtn}
            onMouseDown={holdFocus}
            onClick={onOpenDebug}
            disabled={running}
            aria-label="打开调试台"
            title="调试台：自由组合能力并试跑（不需要先选智能体）"
          >
            <ExperimentOutlined />
          </button>
        )}
        {showSettings && onOpenSettings && (
          <button
            type="button"
            className={styles.toolIconBtn}
            onMouseDown={holdFocus}
            onClick={onOpenSettings}
            aria-label="智能体设置"
            title="智能体设置"
          >
            <SettingOutlined />
          </button>
        )}
        {showHistory && onOpenHistory && (
          <button
            type="button"
            className={styles.toolIconBtn}
            onMouseDown={holdFocus}
            onClick={onOpenHistory}
            aria-label="聊天历史"
            title="聊天历史"
          >
            <ClockCircleOutlined />
          </button>
        )}
        <button
          type="button"
          className={styles.newSessionBtn}
          onMouseDown={holdFocus}
          onClick={onNewThread}
          aria-label="新建会话"
          title="新建会话"
        >
          <PlusOutlined />
        </button>
      </div>

      <div className={`${styles.inputBox} ${dragDepth > 0 ? styles.inputBoxDropTarget : ''}`}>
        <PendingAttachmentStrip attachments={attachments} onRemove={onRemoveAttachment} />
        <PendingImageStrip images={images} onRemove={onRemoveImage} />
        {attachments.length > 0 && (
          <div className={styles.pendingHint}>
            附件目前只做本地展示，尚未传给智能体（等后端支持）。
          </div>
        )}
        <Input.TextArea
          value={draft}
          onChange={event => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className={styles.chatInput}
          variant="borderless"
          autoSize={{ minRows: 2, maxRows: 6 }}
          maxLength={CHAT_LIMITS.messageMaxLength}
          disabled={suspended}
          placeholder={
            suspended
              ? '等待你处理上面的确认…'
              : running
                ? '正在生成，可以先把下一条写好…'
                : '输入消息，回车发送；Shift+Enter 换行'
          }
        />
        <div className={styles.inputActions}>
          <button
            type="button"
            className={`${styles.thinkToggle} ${reasoning ? styles.thinkToggleOn : ''}`}
            onMouseDown={holdFocus}
            onClick={() => onReasoningChange(!reasoning)}
            aria-pressed={reasoning}
            title="请求推理流"
          >
            <BulbOutlined />
            思考
          </button>

          {charCount > 0 && (
            <span
              className={`${styles.charCount} ${
                charCount >= CHAT_LIMITS.messageMaxLength ? styles.charCountFull : ''
              }`}
            >
              {charCount}/{CHAT_LIMITS.messageMaxLength}
            </span>
          )}

          {running ? (
            <button
              type="button"
              className={styles.stopBtn}
              onClick={onStop}
              aria-label="停止生成"
              title="停止生成"
            >
              <StopOutlined />
            </button>
          ) : (
            <button
              type="button"
              className={styles.sendBtn}
              onClick={onSend}
              disabled={!canSend}
              aria-label="发送"
              title="发送"
            >
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden="true">
                <path
                  d="M21 3L10.5 13.5M21 3l-6.2 18-4.3-7.5L3 9.2 21 3z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
