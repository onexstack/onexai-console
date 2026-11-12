import { useEffect, useState } from 'react';
import { Alert, Space, Spin, Tag, Timeline, Typography } from 'antd';

import { listTicketNotes } from '@/api/onexai';
import type { TicketNote } from '@/api/types';

/**
 * 工单的处理记录（`/mark` 逐条写下的）。
 *
 * # 为什么是一个面板，而不是描述符里的几个字段
 *
 * 记录在 `chat.ticket_note` 子表里——一条 /mark 一行，各自带作者与时间。它不是工单行
 * 上的字段，所以描述符（`fields`/`tabs`）表达不了它：那里的每一行都对应工单行的一个键。
 * 工单行上曾经有过一个 `processing_record` 文本列，把日志塞进一个字段正是这次重构要
 * 修掉的东西。
 *
 * # 时间戳
 *
 * 页面别处的时间按原样显示 ISO 串；这里格式化。一段日志就是按时间读的，带微秒的 ISO
 * 串在时间线上读不动，而读不出时间是这块面板唯一的价值所在。这是刻意的局部例外。
 */
export default function TicketNotesPanel({ ticket }: { ticket: string }) {
  const [notes, setNotes] = useState<TicketNote[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 切换工单时先清空，否则新工单会短暂显示上一张的日志。
    let cancelled = false;
    setNotes(null);
    setError(null);
    void (async () => {
      try {
        const result = await listTicketNotes(ticket);
        if (cancelled) return;
        setNotes(result.notes);
        setTotal(result.total);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '处理记录加载失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticket]);

  if (error) {
    return <Alert type="error" showIcon title="处理记录读取失败" description={error} />;
  }
  if (notes === null) return <Spin />;
  if (notes.length === 0) {
    return <Typography.Text type="secondary">这张工单还没有处理记录。</Typography.Text>;
  }

  return (
    <>
      {total > notes.length && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={`共 ${total} 条，这里显示最早 ${notes.length} 条`}
        />
      )}
      <Timeline
        items={notes.map((note, index) => ({
          key: note.id ?? `${note.ticket_id}-${index}`,
          color: note.review ? 'orange' : note.demand ? 'blue' : 'gray',
          children: (
            <Space direction="vertical" size={2}>
              <Space size={6} wrap>
                <Typography.Text strong>
                  {note.author_name || note.author_id || '未知记录人'}
                </Typography.Text>
                <Typography.Text type="secondary">{formatTime(note.created_at)}</Typography.Text>
                {note.review && <Tag color="orange">需复盘</Tag>}
                {note.demand && <Tag color="blue">转需求</Tag>}
              </Space>
              <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{note.note}</Typography.Text>
            </Space>
          ),
        }))}
      />
    </>
  );
}

/** 把 ISO 串显示成本地时间；解析不了就原样返回，不编造一个时间。 */
function formatTime(iso?: string): string {
  if (!iso) return '';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString('zh-CN', { hour12: false });
}
