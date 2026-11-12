import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import { ReloadOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { listFeishuBindings, listFeishuPeerBindings, unbindFeishuPeerBinding } from '@/api/auth';
import type { FeishuPeerBinding, MeResponse } from '@/api/types';
import { decodeClaims } from '@/auth/claims';
import { useMe } from '@/auth/useMe';
import { useSessionToken } from '@/auth/tokenStore';
import FeishuBindModal from '@/components/FeishuBindModal';
import { formatDate } from '@/lib/date';
import { useTranslation } from '@/runtime';
import {
  MoreActions,
  RESOURCE_ACTION_COLUMN,
  RESOURCE_ACTION_COLUMN_WIDTH,
  RESOURCE_TABLE_LAYOUT,
} from '@/ui';
import { CopyButton } from '@/ui/components/CopyButton';
import { ListPagination } from '@/ui/components/Pagination';
import { useIsMobile } from '@/ui/responsive';

import BindingDrawer from './BindingDrawer';
import MyFeishuCard from './MyFeishuCard';
import { reasonText } from './meta';
import styles from './styles.module.scss';

const PAGE_SIZE = 20;

/**
 * 账号页「飞书绑定」板块。
 *
 * 独立页（`/feishu-bindings`）已迁移进账号页，这里不再套 `ResourceShell`：
 * `AccountPage` 的 `.content` 已经提供内边距与滚动容器，再套一层会重复叠加
 * `--page-gutter` 与嵌套滚动。
 *
 * # 两块职责
 *
 * 顶部「我的飞书」卡负责账号级绑定 / 解绑（`peer_bind_claim` 握手证明
 * 「说话的人是谁」）；下方列表管理握手之后的长期映射（`PeerBinding.agents`），
 * 需要搜索、分页和跨账号治理。每个动作只留一个入口：自己的身份只在卡片里
 * 解绑，智能体只在列表行里配置（卡片不再提供「配置智能体」）。
 *
 * # 谁能看见什么
 *
 * 服务端按令牌角色收窄：普通用户只看到自己的行，管理员看到全部。前端不再
 * 复制一套权限判断，只渲染 `writable` / `can_unbind`；用自己的 ID 收起行内
 * 解绑，避免和卡片重复。
 */
export function FeishuBindingsPanel() {
  const { message, modal } = App.useApp();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const isMobile = useIsMobile();

  const [searchParams, setSearchParams] = useSearchParams();
  const drawerPeerID = searchParams.get('open') ?? '';

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [keyword, setKeyword] = useState('');
  const [source, setSource] = useState('');
  const [bindOpen, setBindOpen] = useState(false);

  const meQuery = useMe();
  const me = meQuery.data;

  const query = useQuery({
    queryKey: ['feishu-bindings', { page, pageSize, keyword, source }],
    queryFn: () => listFeishuPeerBindings({ page, pageSize, keyword, source }),
    // 控制面是 informer 读；短缓存只会让「刚改完又读回旧值」更明显。
    staleTime: 0,
  });

  const rows = useMemo(() => query.data?.bindings ?? [], [query.data]);
  const total = query.data?.total ?? 0;

  const ownOpenID = me?.feishu?.open_id;
  // `me` 尚未返回时用令牌里的 user_id 兜底，避免自己的行短暂露出解绑按钮。
  const selfUserID = me?.user.id ?? claims?.userId;

  const isOwnRow = useCallback(
    (row: FeishuPeerBinding) => {
      if (ownOpenID && row.peer_id === ownOpenID) return true;
      if (!selfUserID) return false;
      return row.canonical === selfUserID || row.account?.id === selfUserID;
    },
    [ownOpenID, selfUserID]
  );

  const ownRow = useMemo(() => rows.find(row => isOwnRow(row)), [rows, isOwnRow]);

  // 函数式更新让回调本身保持稳定：弹窗的轮询 effect 依赖父组件传入的
  // `onClose`/`onBound`，内联函数会让它在每次重渲染时重启一次定时器。
  const openDrawer = useCallback(
    (peerID: string) => {
      setSearchParams(
        previous => {
          const next = new URLSearchParams(previous);
          next.set('open', peerID);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const closeDrawer = useCallback(() => {
    setSearchParams(
      previous => {
        const next = new URLSearchParams(previous);
        next.delete('open');
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const openBind = useCallback(() => setBindOpen(true), []);
  const closeBind = useCallback(() => setBindOpen(false), []);

  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  // 面板会随 tab 切换卸载；延迟打开抽屉的定时器必须一起清掉，否则切走之后
  // 仍会把 `?open=` 写回 URL，下次回到飞书页抽屉会莫名弹开。
  const aliveRef = useRef(true);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  /**
   * 绑定成功后的收尾。
   *
   * 账号绑定立刻可读，但机器人侧的投影来自 informer，可能晚一两秒。这里不
   * 立刻把列表标成已刷新，而是等一小会儿再取，并把刚绑定的身份直接打开——
   * 即使投影还没到，抽屉也会诚实地显示 `account_only`。
   */
  const handleBound = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    await queryClient.invalidateQueries({ queryKey: ['users'] });

    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void queryClient.invalidateQueries({ queryKey: ['feishu-bindings'] });

      const openFresh = (openID: string) => {
        // 详情查询可能缓存了绑定前的 404 或旧状态，打开前先丢掉。
        queryClient.removeQueries({ queryKey: ['feishu-binding', openID] });
        if (aliveRef.current) openDrawer(openID);
      };

      // 刚 await 过 `['auth','me']` 的失效，缓存里应有最新的 open_id；
      // 取不到时再用账号级绑定接口兜底。
      const fresh = queryClient.getQueryData<MeResponse>(['auth', 'me']);
      const openID = fresh?.feishu?.open_id;
      if (openID) {
        openFresh(openID);
        return;
      }

      void listFeishuBindings()
        .then(bindings => {
          const id = bindings[0]?.open_id;
          if (id) openFresh(id);
        })
        .catch(() => {
          // 列表会在下次进入/聚焦时自行刷新。
        });
    }, 2000);
  }, [openDrawer, queryClient]);

  /** 卡片解绑后的收尾：清详情缓存、必要时收起抽屉，再失效三处读模型。 */
  const handleUnbound = useCallback(
    async (openID: string) => {
      queryClient.removeQueries({ queryKey: ['feishu-binding', openID] });
      if (drawerPeerID === openID) closeDrawer();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['feishu-bindings'] }),
      ]);
    },
    [closeDrawer, drawerPeerID, queryClient]
  );

  const remove = useCallback(
    async (row: FeishuPeerBinding) => {
      try {
        await unbindFeishuPeerBinding(row.peer_id);
        message.success('已解绑飞书身份');
        await queryClient.invalidateQueries({ queryKey: ['feishu-bindings'] });
        await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
        await queryClient.invalidateQueries({ queryKey: ['users'] });
      } catch (err) {
        message.error(err instanceof Error ? err.message : '解绑失败');
      }
    },
    [message, queryClient]
  );

  const columns = useMemo<TableColumnsType<FeishuPeerBinding>>(
    () => [
      {
        title: '飞书账号',
        key: 'feishu',
        // 头像 + 名称 + open_id + 复制按钮，给一档更宽的首列；手机上收窄到
        // 与剩余视口相称，避免被吸附的操作列盖住。
        width: isMobile ? 190 : 270,
        render: (_, row) => {
          const name = row.feishu?.name || '未命名飞书账号';
          // 32 位 open_id 原样铺在表格里会把首列撑宽、整张表横向溢出；列表里
          // 只显示首尾，完整值在 title / 复制按钮 / 抽屉详情里都拿得到。
          const shortPeerID =
            row.peer_id.length > 20
              ? `${row.peer_id.slice(0, 10)}…${row.peer_id.slice(-6)}`
              : row.peer_id;
          return (
            // 不用 antd `<Space>`：它的 item 不收缩，长 open_id 会把首列撑出
            // 偏好宽度，整张表因此横向溢出。这里用可收缩的 flex 行。
            <div className={styles.feishuCell}>
              <Avatar
                size={32}
                src={row.feishu?.avatar_url}
                icon={<TeamOutlined />}
                className={styles.avatar}
              />
              <div className={styles.identity}>
                <div className={styles.identityName}>
                  <span className={styles.identityNameText}>{name}</span>
                  {isOwnRow(row) && <Tag color="blue">我</Tag>}
                  <StateTag row={row} />
                </div>
                <div className={styles.identityId}>
                  <span className={styles.mono} title={row.peer_id}>
                    {shortPeerID}
                  </span>
                  <CopyButton value={row.peer_id} ariaLabel="复制飞书 open_id" />
                </div>
              </div>
            </div>
          );
        },
      },
      {
        title: '平台账号',
        key: 'account',
        width: 140,
        // 手机上收起这一列：账号详情在抽屉里看，行内只留识别与配置入口。
        responsive: ['sm'],
        render: (_, row) =>
          row.account ? (
            <div className={styles.identity}>
              <span>{row.account.display_name || row.account.username}</span>
              <span className={styles.secondary}>{row.account.username}</span>
            </div>
          ) : (
            <Typography.Text type="danger">账号不存在</Typography.Text>
          ),
      },
      {
        title: '可用智能体',
        key: 'agents',
        width: 150,
        render: (_, row) => <AgentTags row={row} />,
      },
      {
        title: '来源',
        key: 'source',
        width: 96,
        responsive: ['md'],
        render: (_, row) => <SourceTag row={row} />,
      },
      {
        title: '更新时间',
        key: 'updated_at',
        width: 150,
        responsive: ['md'],
        render: (_, row) => (
          <span className={styles.secondary}>
            {row.updated_at ? formatDate(row.updated_at) : '-'}
          </span>
        ),
      },
      {
        title: '操作',
        key: 'actions',
        ...RESOURCE_ACTION_COLUMN,
        // 窄屏按钮更少，操作列可以再收一档。
        width: isMobile ? 150 : RESOURCE_ACTION_COLUMN_WIDTH,
        render: (_, row) => {
          // 自己的身份统一回「我的飞书」卡里解绑，行上不出现解绑入口。
          const own = isOwnRow(row);
          const reason = row.readonly_reason ? reasonText(row.readonly_reason) : '当前不可解绑';
          // 机器人侧指向的账号已不存在时，解绑只清理这行残留，不会影响现存账号。
          const confirmContent = row.account
            ? '解绑后，该账号在飞书里将不再按此平台账号识别，@peer 也不可用。'
            : '机器人侧这条绑定指向的账号已不存在，解绑只会删除这条残留记录，不影响任何现存账号。';
          const moreItems: MenuProps['items'] = own
            ? []
            : [
                {
                  key: 'unbind',
                  label: <span title={row.can_unbind ? undefined : reason}>解绑</span>,
                  danger: true,
                  disabled: !row.can_unbind,
                },
              ];

          return (
            <Space size={4} onClick={event => event.stopPropagation()} className={styles.actions}>
              <Button
                type="link"
                size="small"
                className={styles.actionLink}
                onClick={() => openDrawer(row.peer_id)}
              >
                配置智能体
              </Button>
              {/* 解绑不可逆，收进「更多」；确认用模态——菜单项里塞不进 Popconfirm。 */}
              <MoreActions
                items={moreItems}
                onClick={({ key }) => {
                  if (key !== 'unbind') return;
                  modal.confirm({
                    title: '解绑这个飞书身份？',
                    content: confirmContent,
                    okText: '解绑',
                    okButtonProps: { danger: true },
                    cancelText: '取消',
                    onOk: () => remove(row),
                  });
                }}
              />
            </Space>
          );
        },
      },
    ],
    [isMobile, isOwnRow, openDrawer, remove, modal]
  );

  return (
    <>
      <div className={styles.panel}>
        <MyFeishuCard
          me={me}
          loading={meQuery.isLoading}
          error={meQuery.error}
          onRetry={() => void meQuery.refetch()}
          ownRow={ownRow}
          onBind={openBind}
          onUnbound={handleUnbound}
        />

        <Card
          className={styles.card}
          title="飞书身份"
          extra={
            <Tooltip title="刷新">
              <Button
                icon={<ReloadOutlined />}
                size="small"
                aria-label="刷新"
                loading={query.isFetching}
                onClick={refresh}
              />
            </Tooltip>
          }
          styles={{ body: { padding: 0 } }}
        >
          <div className={styles.toolbar}>
            <Input.Search
              className={styles.search}
              allowClear
              placeholder="搜索飞书姓名、open_id、平台账号"
              prefix={<SearchOutlined />}
              onSearch={value => {
                setKeyword(value.trim());
                setPage(1);
              }}
            />
            <Select
              className={styles.sourceSelect}
              value={source}
              onChange={value => {
                setSource(value);
                setPage(1);
              }}
              options={[
                { value: '', label: '全部来源' },
                { value: 'console', label: '控制台' },
                { value: 'onex-iam', label: 'onex-iam' },
                { value: 'none', label: '仅账号' },
              ]}
            />
            <span className={styles.toolbarHint}>点击任意一行可配置 @peer 智能体</span>
          </div>

          {query.isError ? (
            <Alert
              type="error"
              showIcon
              className={styles.cardAlert}
              title="读取飞书绑定失败"
              description={query.error instanceof Error ? query.error.message : undefined}
              action={
                <Button size="small" onClick={refresh}>
                  重试
                </Button>
              }
            />
          ) : (
            <>
              <Table
                rowKey="peer_id"
                size="middle"
                columns={columns}
                dataSource={rows}
                loading={query.isLoading}
                pagination={false}
                // 中间列按内容、整表铺满卡片；操作列贴右缘并吸附。
                {...RESOURCE_TABLE_LAYOUT}
                locale={{
                  emptyText: (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={
                        keyword || source
                          ? '没有匹配的飞书身份。'
                          : '还没有飞书身份记录，可在上方「我的飞书」中绑定。'
                      }
                    />
                  ),
                }}
                onRow={row => ({
                  onClick: () => openDrawer(row.peer_id),
                  style: { cursor: 'pointer' },
                })}
              />
              <div className={styles.footer}>
                <ListPagination
                  total={total}
                  page={page}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={size => {
                    setPageSize(size);
                    setPage(1);
                  }}
                  hideOnSinglePage={false}
                  t={t}
                />
              </div>
            </>
          )}
        </Card>
      </div>

      <FeishuBindModal open={bindOpen} onClose={closeBind} onBound={handleBound} />
      <BindingDrawer peerID={drawerPeerID} open={Boolean(drawerPeerID)} onClose={closeDrawer} />
    </>
  );
}

/** 「仅 Peer 行」「未同步」「账号冲突」这类行级状态，只在需要时出现。 */
function StateTag({ row }: { row: FeishuPeerBinding }) {
  switch (row.state) {
    case 'mismatch':
      // 两侧指向不同账号。被指向的账号可能仍存在（真正的冲突），也可能已经
      // 删除或从未在本部署存在（迁移遗留），后者说成「账号冲突」会误导用户。
      return row.account ? (
        <Tag color="error">账号冲突</Tag>
      ) : (
        <Tag color="warning">绑定失效</Tag>
      );
    case 'account_only':
      return <Tag color="warning">未同步</Tag>;
    case 'peer_only':
      return <Tag>仅 Peer 行</Tag>;
    default:
      return null;
  }
}

function AgentTags({ row }: { row: FeishuPeerBinding }) {
  if (row.agents.length === 0) {
    // `@peer` 不可用的完整解释在抽屉里；表格里只留一个弱化的状态，避免长文案
    // 把这一列撑成两行、和旁边的 Tag 挤在一起。
    return <span className={styles.secondary}>未配置</span>;
  }
  const shown = row.agents.slice(0, 1);
  const rest = row.agents.slice(1);
  return (
    <Space size={[4, 4]} wrap>
      {shown.map(name => (
        <Tag key={name} color="blue">
          {name}
        </Tag>
      ))}
      {rest.length > 0 && (
        <Tooltip title={rest.join('、')}>
          <Tag>+{rest.length}</Tag>
        </Tooltip>
      )}
    </Space>
  );
}

function SourceTag({ row }: { row: FeishuPeerBinding }) {
  if (row.state === 'account_only') {
    return <Tag>仅账号</Tag>;
  }
  if (row.source === 'console') {
    return <Tag color="blue">控制台</Tag>;
  }
  if (row.source === 'onex-iam') {
    return <Tag color="purple">onex-iam</Tag>;
  }
  // 迁移遗留的旧来源（例如 onex）原样展示，比笼统的「未知」更能解释这行数据。
  return row.source ? <Tag>{row.source}</Tag> : <Tag>未知</Tag>;
}
