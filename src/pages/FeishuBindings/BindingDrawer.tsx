import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Avatar,
  Button,
  Descriptions,
  Divider,
  Empty,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import type { DescriptionsProps } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getFeishuPeerBinding, updateFeishuPeerBindingAgents } from '@/api/auth';
import { fetchAllRows, resourceRowsQueryKey } from '@/api/resourceDefs';
import type { FeishuPeerBinding, FeishuPeerBindingListResponse } from '@/api/types';
import { OptionLabel } from '@/components/OptionLabel';
import { matchOptionText, normalizeOptionDescription } from '@/components/OptionLabel/helpers';
import { formatDate } from '@/lib/date';
import { CopyButton } from '@/ui/components/CopyButton';
import { ResizableDrawer } from '@/ui';

import { reasonText } from './meta';
import styles from './styles.module.scss';

/**
 * 一条飞书绑定的详情与智能体配置。
 *
 * 用抽屉而不是详情页：这条记录只有「身份 + 一个智能体 + 审计时间」，离开列表
 * 去整页读它会丢掉用户正在比较的上下文。
 *
 * 解绑不在这里：自己的身份统一回「我的飞书」卡解绑，他人的行在列表行操作里
 * 解绑。抽屉只负责 `@peer` 可用的那一个智能体。
 */
export default function BindingDrawer({
  peerID,
  open,
  onClose,
}: {
  peerID: string;
  open: boolean;
  onClose: () => void;
}) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['feishu-binding', peerID],
    queryFn: () => getFeishuPeerBinding(peerID),
    enabled: open && Boolean(peerID),
  });
  // 直连 agent 的声明式资源面，与 /agents 列表页共用同一份全量缓存。此前走
  // chat 的 `/v1/agents` 代理：浏览器只读一个目录却依赖 chat 的服务凭据，
  // 凭据一旦缺失，这里就 401，而其它页面都还好。
  const agentsQuery = useQuery({
    queryKey: resourceRowsQueryKey('agents'),
    queryFn: () => fetchAllRows('agents'),
    staleTime: 30_000,
    enabled: open,
  });

  const data = query.data;
  const serverAgents = useMemo(() => data?.agents ?? [], [data?.agents]);

  const [draft, setDraft] = useState<string[]>([]);
  const [draftPeer, setDraftPeer] = useState('');
  const [saving, setSaving] = useState(false);

  // 跟随服务端值，但只在一行第一次打开时重置；正在编辑的草稿不会被后台刷新
  // 悄悄覆盖。
  useEffect(() => {
    if (!open) {
      setDraftPeer('');
      setDraft([]);
      return;
    }
    if (!data || draftPeer === data.peer_id) return;
    setDraftPeer(data.peer_id);
    setDraft(data.agents);
  }, [data, draftPeer, open]);

  const dirty = !sameList(draft, serverAgents);

  // 资源面的行是 camelCase，且是 `Record<string, unknown>`：在这里收敛成组件需要
  // 的三个字段，避免把类型断言散落到渲染里。
  const agentRows = useMemo(
    () =>
      (agentsQuery.data ?? [])
        .map(row => ({
          name: typeof row.name === 'string' ? row.name : '',
          displayName: typeof row.displayName === 'string' ? row.displayName : '',
          status: typeof row.status === 'string' ? row.status : '',
          description: typeof row.description === 'string' ? row.description : '',
        }))
        .filter(agent => agent.name),
    [agentsQuery.data]
  );
  const agentOptions = useMemo(
    () =>
      agentRows.map(agent => ({
        value: agent.name,
        // 下拉与已选值都只显示显示名；资源名留在搜索里，按 yaml 里的名字也能找到。
        label: agent.displayName || agent.name,
        description: normalizeOptionDescription(agent.description),
        name: agent.name,
        // 停用的智能体仍然可见：已绑定的历史值要能显示出来，只是不能再新选。
        disabled: agent.status === 'disabled',
      })),
    [agentRows]
  );
  const knownAgents = useMemo(() => new Set(agentRows.map(agent => agent.name)), [agentRows]);
  const staleAgents = useMemo(
    () => (agentsQuery.isSuccess ? draft.filter(name => !knownAgents.has(name)) : []),
    [agentsQuery.isSuccess, draft, knownAgents]
  );
  const selectedAgent = useMemo(
    () => agentRows.find(agent => agent.name === draft[0]),
    [agentRows, draft]
  );
  // 历史数据可能还挂着多个智能体：单选框只展示第一个，保存时收敛为 1 个。
  const legacyAgents = useMemo(
    () => (serverAgents.length > 1 ? serverAgents.slice(1) : []),
    [serverAgents]
  );

  /** 把写完的值直接落到详情与列表缓存里：控制面的读是缓存读，立刻重取可能读到旧值。 */
  const applyUpdate = (next: FeishuPeerBinding) => {
    queryClient.setQueryData(['feishu-binding', peerID], next);
    queryClient.setQueriesData<FeishuPeerBindingListResponse>(
      { queryKey: ['feishu-bindings'] },
      old =>
        old
          ? {
              ...old,
              bindings: old.bindings.map(row => (row.peer_id === peerID ? next : row)),
            }
          : old
    );
    void queryClient.invalidateQueries({
      queryKey: ['feishu-bindings'],
      refetchType: 'none',
    });
  };

  const save = async () => {
    if (!data || !dirty) return;
    setSaving(true);
    try {
      const next = await updateFeishuPeerBindingAgents(data.peer_id, draft);
      applyUpdate(next);
      setDraft(next.agents);
      message.success('已保存可用智能体');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (saving) return;
    if (!dirty) {
      onClose();
      return;
    }
    modal.confirm({
      title: '放弃未保存的修改？',
      content: '关闭后，本次选择的智能体不会保存。',
      okText: '放弃',
      okButtonProps: { danger: true },
      cancelText: '继续编辑',
      onOk: onClose,
    });
  };

  const items = useMemo<DescriptionsProps['items']>(() => {
    if (!data) return [];
    const feishu = data.feishu;
    return [
      {
        key: 'feishu',
        label: '飞书身份',
        children: (
          <Space size={8} wrap>
            <Avatar size={24} src={feishu?.avatar_url} icon={<TeamOutlined />} />
            <span>{feishu?.name || '未命名飞书账号'}</span>
            <span className={styles.mono}>{data.peer_id}</span>
            <CopyButton value={data.peer_id} ariaLabel="复制飞书 open_id" />
          </Space>
        ),
      },
      ...(feishu?.union_id
        ? [
            {
              key: 'union_id',
              label: 'Union ID',
              children: <span className={styles.mono}>{feishu.union_id}</span>,
            },
          ]
        : []),
      {
        key: 'account',
        label: '平台账号',
        children: data.account ? (
          <Space size={8}>
            <span>{data.account.display_name || data.account.username}</span>
            <span className={styles.secondary}>{data.account.username}</span>
            <Tag color={data.account.status === 'active' ? 'success' : 'default'}>
              {data.account.status === 'active' ? '正常' : '已禁用'}
            </Tag>
          </Space>
        ) : (
          <Typography.Text type="danger">账号不存在</Typography.Text>
        ),
      },
      {
        key: 'source',
        label: '绑定来源',
        children: <SourceLabel data={data} />,
      },
      {
        key: 'scope',
        label: '飞书应用',
        children: <span className={styles.mono}>{data.scope || '-'}</span>,
      },
      {
        key: 'times',
        label: '时间',
        children: (
          <div className={styles.times}>
            <span>绑定：{feishu?.bound_at ? formatDate(feishu.bound_at) : '-'}</span>
            <span>更新：{data.updated_at ? formatDate(data.updated_at) : '-'}</span>
          </div>
        ),
      },
    ];
  }, [data]);

  return (
    <ResizableDrawer
      open={open}
      onClose={close}
      defaultWidth={560}
      minWidth={420}
      storageKey="feishu_binding"
      destroyOnHidden
      title={data?.feishu?.name || '飞书绑定'}
      classNames={{
        header: styles.drawerHeader,
        title: styles.drawerTitle,
        body: styles.drawerBody,
      }}
    >
      {query.isLoading ? (
        <div className={styles.drawerCenter}>
          <Spin />
        </div>
      ) : query.isError ? (
        <Alert
          type="error"
          showIcon
          title="读取飞书绑定失败"
          description={query.error instanceof Error ? query.error.message : undefined}
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        />
      ) : !data ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到该飞书绑定" />
      ) : (
        <div className={styles.drawerContent}>
          <Descriptions
            className={styles.descriptions}
            column={1}
            size="small"
            colon={false}
            items={items}
          />

          <StateAlerts data={data} />

          <Divider className={styles.divider} />

          <section className={styles.section}>
            <div className={styles.sectionTitle}>可用智能体</div>
            <Typography.Paragraph type="secondary" className={styles.hint}>
              飞书里 <code>@peer</code> 会解析成这个智能体（每个飞书身份只能配置 1
              个）。私聊里它优先于会话中的 <code>/agent</code> 声明；群聊里会话声明优先。
              留空表示已绑定但不开放 <code>@peer</code>，此时按会话声明解析，没有声明时
              回退到默认模板。
            </Typography.Paragraph>
            <Select
              allowClear
              showSearch
              placeholder="选择这个飞书账号可用的智能体"
              style={{ width: '100%' }}
              value={draft[0]}
              options={agentOptions}
              loading={agentsQuery.isLoading}
              disabled={!data.writable}
              optionRender={option => {
                const data = option.data as { description?: string };
                return <OptionLabel title={option.label} description={data.description} />;
              }}
              filterOption={(input, option) =>
                matchOptionText(input, option?.label, option?.name, option?.description)
              }
              onChange={value => setDraft(value ? [value] : [])}
            />
            {selectedAgent?.description && (
              <div className={styles.hint}>{selectedAgent.description}</div>
            )}
            {legacyAgents.length > 0 && (
              <Alert
                type="warning"
                showIcon
                title={`这条绑定当前关联了 ${serverAgents.length} 个智能体`}
                description={
                  draft[0]
                    ? `每个飞书身份只能使用 1 个智能体；保存后将只保留 ${draft[0]}。`
                    : '每个飞书身份只能使用 1 个智能体；当前已清空，保存后将不保留任何智能体。'
                }
                action={
                  <Button
                    size="small"
                    onClick={() => {
                      const first = serverAgents[0];
                      if (first) setDraft([first]);
                    }}
                  >
                    仅保留第一个
                  </Button>
                }
              />
            )}
            {agentsQuery.isError && (
              <Alert
                type="warning"
                showIcon
                title="智能体目录读取失败"
                description={
                  agentsQuery.error instanceof Error
                    ? agentsQuery.error.message
                    : '已绑定的名字仍然保留，但暂时无法校验新增的名字。'
                }
                action={
                  <Button
                    size="small"
                    loading={agentsQuery.isFetching}
                    onClick={() => void agentsQuery.refetch()}
                  >
                    重试
                  </Button>
                }
              />
            )}
            {staleAgents.length > 0 && (
              <div className={styles.staleRow}>
                <span>已失效：</span>
                {staleAgents.map(name => (
                  <Tag key={name} color="error">
                    {name}
                  </Tag>
                ))}
              </div>
            )}
            <div className={styles.preview}>{peerPreview(draft)}</div>
            <div className={styles.sectionActions}>
              {dirty && (
                <Button onClick={() => setDraft(serverAgents)} disabled={saving}>
                  取消
                </Button>
              )}
              <Button
                type="primary"
                loading={saving}
                disabled={!data.writable || !dirty}
                onClick={() => void save()}
              >
                保存
              </Button>
            </div>
          </section>
        </div>
      )}
    </ResizableDrawer>
  );
}

function SourceLabel({ data }: { data: FeishuPeerBinding }) {
  if (data.state === 'account_only') {
    return <Tag>仅账号绑定</Tag>;
  }
  if (data.source === 'console') {
    return <Tag color="blue">控制台</Tag>;
  }
  if (data.source === 'onex-iam') {
    return <Tag color="purple">onex-iam</Tag>;
  }
  return data.source ? <Tag>{data.source}</Tag> : <Tag>未知来源</Tag>;
}

function StateAlerts({ data }: { data: FeishuPeerBinding }) {
  // 没有关联到有效账号时先说明这件事：它才是这行不可编辑、并且只能靠
  // 「解绑后重新绑定」修复的原因；来源标签解释不了这个状态。
  if (!data.account) {
    return (
      <Alert
        type="error"
        showIcon
        title="绑定没有关联到有效账号"
        description="机器人侧仍把这条飞书身份关联到一个已删除或不存在的平台账号（可能是历史迁移遗留）。管理员可以直接解绑这条残留记录；该飞书身份随后重新绑定时会接管并修正它。"
      />
    );
  }
  if (data.source === 'onex-iam') {
    return (
      <Alert type="info" showIcon title="由 onex-iam 管理" description={reasonText('external')} />
    );
  }
  if (data.state === 'mismatch') {
    return (
      <Alert
        type="error"
        showIcon
        title="绑定指向了另一个账号"
        description={reasonText('canonical_mismatch')}
      />
    );
  }
  if (data.state === 'account_only') {
    return (
      <Alert type="warning" showIcon title="机器人侧尚未同步" description={reasonText('no_peer')} />
    );
  }
  if (!data.canonical) {
    return (
      <Alert
        type="warning"
        showIcon
        title="缺少平台账号"
        description={reasonText('canonical_missing')}
      />
    );
  }
  return null;
}

function peerPreview(agents: string[]): string {
  if (agents.length === 0) {
    return '留空或没有可用智能体时，会按会话声明解析；没有声明才回退到 @default。';
  }
  return `@peer → ${agents.join('、')}`;
}

/** 集合比较：列表的顺序不承载语义，重排不应当算一次修改。 */
function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every(value => set.has(value));
}
