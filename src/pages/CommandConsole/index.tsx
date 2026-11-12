import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Alert, Button, Card, Empty, Input, Space, Spin, Tabs, Tag, Tree, Typography } from 'antd';
import { PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';

import { execCommand, listCommandTree } from '@/api/chat';
import type { CommandNode, ExecCommandResponse } from '@/api/types';
import { PageHeader, PageSurface } from '@/ui';

interface TreeNode {
  key: string;
  title: string;
  node: CommandNode;
  children?: TreeNode[];
}

function toTree(nodes: CommandNode[], parent = ''): TreeNode[] {
  return nodes.map(node => {
    const key = parent ? `${parent} ${node.name}` : node.name;
    return {
      key,
      title: node.short ? `${node.name} — ${node.short}` : node.name,
      node,
      ...(node.subcommands?.length ? { children: toTree(node.subcommands, key) } : {}),
    };
  });
}

/**
 * 命令台。
 *
 * 这是 chat 服务的 slash 命令，不是前端的快速跳转（⌘K）。默认走自由文本
 * `/v1/commands/exec`：`/v1/cli/:cmdname` 会把 body 映射成 flags 并遍历 Go map，
 * flag 的顺序不确定，对顺序敏感的命令不能走那条路。
 */
export default function CommandConsolePage() {
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<CommandNode | null>(null);
  // 值班组详情页的「在命令台执行」用 ?command= 预填命令；会话 ID 仍由用户填写。
  const [command, setCommand] = useState(searchParams.get('command') ?? '');

  useEffect(() => {
    const fromQuery = searchParams.get('command');
    if (fromQuery) setCommand(fromQuery);
  }, [searchParams]);
  const [convId, setConvId] = useState('');
  const [result, setResult] = useState<ExecCommandResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const treeQuery = useQuery({
    queryKey: ['chat', 'commands', 'tree'],
    queryFn: listCommandTree,
    staleTime: 60_000,
  });

  const treeData = useMemo(() => toTree(treeQuery.data ?? []), [treeQuery.data]);

  const run = useMutation({
    mutationFn: () => execCommand(command.trim(), convId.trim() || undefined),
    onSuccess: data => {
      setResult(data);
      setError(null);
    },
    onError: err => {
      setResult(null);
      setError(err instanceof Error ? err.message : '执行失败');
    },
  });

  const execute = () => {
    const text = command.trim();
    if (!text) return;
    if (selected?.dangerous) {
      // 危险命令必须看到全文后再确认。
      const ok = window.confirm(`「${selected.name}」被标记为危险命令，确认执行？\n\n${text}`);
      if (!ok) return;
    }
    run.mutate();
  };

  return (
    <PageSurface>
      <PageHeader title="命令台" inset={false} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Card
          size="small"
          title="命令树"
          style={{ width: 320, flex: '0 0 320px' }}
          extra={
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => void treeQuery.refetch()}
            />
          }
        >
          {treeQuery.isLoading ? (
            <Spin />
          ) : treeQuery.isError ? (
            <Alert
              type="error"
              showIcon
              title="读取命令树失败"
              description={(treeQuery.error as Error).message}
            />
          ) : treeData.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有命令" />
          ) : (
            <Tree
              treeData={treeData}
              showLine
              defaultExpandAll
              onSelect={(_keys, info) => {
                const node = (info.node as unknown as TreeNode).node;
                setSelected(node);
                setCommand(`/${node.name} `);
              }}
            />
          )}
        </Card>

        <div style={{ flex: 1, minWidth: 360 }}>
          <Card size="small" title={selected ? `执行 /${selected.name}` : '执行命令'}>
            {selected ? (
              <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
                <Space wrap>
                  {selected.group && <Tag>{selected.group}</Tag>}
                  {selected.dangerous && <Tag color="red">危险命令</Tag>}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {selected.short}
                  </Typography.Text>
                </Space>
                {selected.flags && selected.flags.length > 0 && (
                  <div style={{ fontSize: 12 }}>
                    <Typography.Text type="secondary">参数：</Typography.Text>
                    {selected.flags.map(flag => (
                      <Tag
                        key={flag.name}
                        style={{ fontFamily: 'var(--font-family-code, monospace)' }}
                      >
                        --{flag.name}
                        {flag.shorthand ? ` (-${flag.shorthand})` : ''}
                        {flag.usage ? `：${flag.usage}` : ''}
                      </Tag>
                    ))}
                  </div>
                )}
              </Space>
            ) : (
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                从左侧选择命令，或直接输入一条命令。
              </Typography.Paragraph>
            )}

            <Input
              value={command}
              onChange={event => setCommand(event.target.value)}
              onPressEnter={execute}
              placeholder="/askai 今天有哪些告警"
              style={{ fontFamily: 'var(--font-family-code, monospace)' }}
            />
            <Space style={{ marginTop: 8 }}>
              <Input
                value={convId}
                onChange={event => setConvId(event.target.value)}
                placeholder="会话 ID（可留空）"
                style={{ width: 260 }}
              />
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={run.isPending}
                disabled={!command.trim()}
                onClick={execute}
              >
                执行
              </Button>
            </Space>

            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              title="flag 顺序"
              description="结构化 flag 入口（/v1/cli/:cmdname）会遍历 Go map，参数顺序不保证。顺序敏感的命令请用上面的自由文本。"
            />
          </Card>

          <Card size="small" title="结果" style={{ marginTop: 16 }}>
            {error && <Alert type="error" showIcon title="执行失败" description={error} />}
            {!error && !result && (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有执行结果" />
            )}
            {result && (
              <Tabs
                size="small"
                items={[
                  {
                    key: 'text',
                    label: '文本',
                    children: result.error ? (
                      <Alert type="error" showIcon title={result.error} />
                    ) : (
                      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13 }}>
                        {result.text || result.markdown?.content || '（空）'}
                      </pre>
                    ),
                  },
                  {
                    key: 'markdown',
                    label: 'Markdown',
                    children: (
                      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>
                        {result.markdown?.content || '（空）'}
                      </pre>
                    ),
                  },
                  {
                    key: 'raw',
                    label: 'Raw',
                    children: (
                      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>
                        {result.raw || '（空）'}
                      </pre>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </div>
      </div>
    </PageSurface>
  );
}
