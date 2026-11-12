import { useState } from 'react';
import { App, Button, Input, Modal } from 'antd';
import { EditOutlined, SearchOutlined } from '@ant-design/icons';

import DeleteIcon from '@/components/DeleteIcon';
import type { ChatThread } from '../transcriptStore';
import { formatTime, groupThreadsByTime, previewText } from './chatUtils';
import { SubpageHeader } from './SubpageHeader';
import styles from './history.module.scss';

export function HistoryPanel({
  threads,
  activeId,
  running,
  onSelect,
  onRename,
  onDelete,
  onClear,
  closeLabel,
  onClose,
}: {
  threads: ChatThread[];
  activeId: string;
  running: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  /** 关闭按钮文案：停靠在右侧时用「收起」。 */
  closeLabel?: string;
  onClose: () => void;
}) {
  const { modal } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [renameTarget, setRenameTarget] = useState<ChatThread | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const normalized = keyword.trim().toLowerCase();
  const filtered = normalized
    ? threads.filter(thread => {
        if (thread.title.toLowerCase().includes(normalized)) return true;
        return thread.messages.some(
          message =>
            message.content.toLowerCase().includes(normalized) ||
            (message.reasoning ?? '').toLowerCase().includes(normalized)
        );
      })
    : threads;
  const groups = groupThreadsByTime(filtered);

  const confirmDelete = (thread: ChatThread) => {
    modal.confirm({
      title: '删除这个会话？',
      content: `「${thread.title}」的本机记录将被删除，不能恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => onDelete(thread.id),
    });
  };

  const confirmClear = () => {
    modal.confirm({
      title: '清空全部历史？',
      content: '当前智能体的本机对话记录将全部删除；服务端记忆不会被清空。',
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: onClear,
    });
  };

  const openRename = (thread: ChatThread) => {
    setRenameTarget(thread);
    setRenameValue(thread.title);
  };

  const submitRename = () => {
    if (!renameTarget) return;
    const title = renameValue.trim();
    if (title) onRename(renameTarget.id, title);
    setRenameTarget(null);
  };

  return (
    <div className={styles.panel}>
      <SubpageHeader
        title="聊天历史"
        closeLabel={closeLabel}
        onClose={onClose}
        extra={
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteIcon />}
            disabled={running || threads.length === 0}
            onClick={confirmClear}
            aria-label="清空历史"
            title={running ? '运行中不能清空' : '清空历史'}
          />
        }
      />

      <div className={styles.search}>
        <Input
          allowClear
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
          prefix={<SearchOutlined />}
          placeholder="搜索会话标题或内容"
        />
      </div>

      <div className={styles.body}>
        {groups.length === 0 ? (
          <div className={styles.empty}>
            {threads.length === 0 ? '还没有会话' : '没有匹配的会话'}
          </div>
        ) : (
          groups.map(group => (
            <section key={group.bucket}>
              <div className={styles.groupLabel}>{group.label}</div>
              {group.items.map(thread => {
                const last = thread.messages[thread.messages.length - 1];
                return (
                  <div
                    key={thread.id}
                    className={`${styles.row} ${thread.id === activeId ? styles.rowActive : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-current={thread.id === activeId}
                    onClick={() => {
                      if (running && thread.id !== activeId) return;
                      onSelect(thread.id);
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        if (running && thread.id !== activeId) return;
                        onSelect(thread.id);
                      }
                    }}
                  >
                    <div className={styles.rowMain}>
                      <div className={styles.rowTitle}>{thread.title}</div>
                      <div className={styles.rowPreview}>
                        {previewText(last?.content) || `${thread.messages.length} 条消息`}
                      </div>
                    </div>
                    <div className={styles.rowAside}>
                      <span className={styles.rowTime}>{formatTime(thread.updatedAt)}</span>
                      <div className={styles.rowActions}>
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={event => {
                            event.stopPropagation();
                            openRename(thread);
                          }}
                          aria-label="重命名会话"
                          title="重命名"
                        />
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteIcon />}
                          disabled={running}
                          onClick={event => {
                            event.stopPropagation();
                            confirmDelete(thread);
                          }}
                          aria-label="删除会话"
                          title="删除"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>

      <Modal
        open={Boolean(renameTarget)}
        title="重命名会话"
        okText="保存"
        cancelText="取消"
        onOk={submitRename}
        onCancel={() => setRenameTarget(null)}
      >
        <Input
          autoFocus
          value={renameValue}
          maxLength={60}
          onChange={event => setRenameValue(event.target.value)}
          onPressEnter={submitRename}
          placeholder="会话标题"
        />
      </Modal>
    </div>
  );
}
