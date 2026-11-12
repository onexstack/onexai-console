import { useMemo } from 'react';
import { Alert, Card, Empty, Space, Tag, Typography } from 'antd';

import { ResizableDrawer } from '@/ui';
import { CopyButton } from '@/ui/components/CopyButton';
import { buildDutyCommands, groupDutyCommands } from '@/components/oncall/commands';

export interface CommandDrawerProps {
  open: boolean;
  onClose: () => void;
  group: string;
  timezone?: string;
  isAdmin: boolean;
}

/**
 * 值班组详情页的命令入口。
 *
 * 页面与 Lark 执行的是同一套 slash 命令，所以这里只展示命令文本，提供复制出口。
 * 命令台（`/command-console`）已从导航中隐藏，因此不再提供「在命令台执行」按钮。
 */
export default function CommandDrawer({
  open,
  onClose,
  group,
  timezone,
  isAdmin,
}: CommandDrawerProps) {
  const entries = useMemo(() => buildDutyCommands({ group, timezone }), [group, timezone]);
  const visible = useMemo(
    () => entries.filter(entry => isAdmin || !entry.adminOnly),
    [entries, isAdmin]
  );
  const groups = useMemo(() => groupDutyCommands(visible), [visible]);

  return (
    <ResizableDrawer
      title="值班命令"
      open={open}
      onClose={onClose}
      defaultWidth={720}
      minWidth={480}
      storageKey="oncall_command"
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        这些命令与控制台页面操作同一套排班数据，可直接复制到 Lark 发送。
        带 <Typography.Text code>{'<...>'}</Typography.Text> 的部分需要替换为实际值后再执行。
      </Typography.Paragraph>
      {!isAdmin ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="写命令需要管理员权限，当前只展示查询命令。"
        />
      ) : null}
      {groups.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可展示的命令" />
      ) : (
        groups.map(({ category, entries: categoryEntries }) => (
          <div key={category} style={{ marginBottom: 20 }}>
            <Typography.Title level={5} style={{ marginBottom: 12 }}>
              {category}
            </Typography.Title>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {categoryEntries.map(entry => (
                <Card size="small" key={entry.key}>
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <Space wrap size={8}>
                      <Typography.Text strong>{entry.label}</Typography.Text>
                      {entry.adminOnly ? <Tag color="orange">管理员</Tag> : null}
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {entry.description}
                    </Typography.Text>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <Typography.Text
                        code
                        style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                      >
                        {entry.command}
                      </Typography.Text>
                      <CopyButton value={entry.command} ariaLabel={`复制命令：${entry.label}`} />
                    </div>
                  </Space>
                </Card>
              ))}
            </Space>
          </div>
        ))
      )}
    </ResizableDrawer>
  );
}
