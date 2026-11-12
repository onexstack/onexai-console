import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { QuestionCircleOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createAccessKey,
  deleteAccessKey,
  listAccessKeys,
  revealAccessKey,
  setAccessKeyEnabled,
} from '@/api/auth';
import type { AccessKey } from '@/api/types';
import { formatDate } from '@/lib/date';
import {
  MoreActions,
  RESOURCE_ACTION_COLUMN,
  RESOURCE_ID_COLUMN_WIDTH,
  RESOURCE_TABLE_LAYOUT,
  SecretValue,
} from '@/ui';
import { CopyButton } from '@/ui/components/CopyButton';
import styles from './styles.module.scss';

/** 可定制显隐的列。AccessKey 是标识本身，永远显示，不在表里。 */
type ColKey = 'name' | 'secretKey' | 'enabled' | 'createdAt' | 'lastUsedAt';

const DEFAULT_COL_VISIBILITY: Record<ColKey, boolean> = {
  name: true,
  secretKey: true,
  enabled: true,
  createdAt: true,
  lastUsedAt: true,
};

const COL_LABELS: Record<ColKey, string> = {
  name: '名称',
  secretKey: 'SecretKey',
  enabled: '状态',
  createdAt: '创建时间',
  lastUsedAt: '最近访问时间',
};

const ALL_COLS = Object.keys(DEFAULT_COL_VISIBILITY) as ColKey[];

/**
 * 凭据管理：当前账号的 AccessKey / SecretKey。
 *
 * 只由账号页（`/account?tab=credentials`）使用；旧地址 `/credentials` 会重定向
 * 到那里，不再有独立页面。
 *
 * # 与登录密码是两件事
 *
 * 密码进控制台；AK/SK 给程序用。两者可以分别停用、分别轮换，所以这里不碰
 * 账号密码，账号密码在「账号设置」里。
 *
 * # SecretKey 默认不可见
 *
 * 列表接口不返回明文。第一次点眼睛时才发一次
 * `GET /v1/aksk/:id`，取回的值只活在这个组件的内存里：刷新即清空。把它写进
 * localStorage 会让一次 XSS 就能带走所有长期凭据，而刷新后重点一下眼睛的
 * 代价只是一个请求。
 *
 * # 「不可查看」是一个真实答案
 *
 * 服务端返回空串表示它还原不出明文（部署没有加密密钥），不是还没取到。页面
 * 必须把这两种情况分开：继续画掩码点会让人以为密钥在、只是被遮住了。
 */
export function AccessKeyPanel() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ name: string }>();

  const query = useQuery({ queryKey: ['access-keys'], queryFn: listAccessKeys });
  const keys = query.data?.keys ?? [];
  const limit = query.data?.limit ?? 0;
  const atLimit = limit > 0 && keys.length >= limit;

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  /** 刚创建出来的那对密钥：明文只在这里停留一次。 */
  const [created, setCreated] = useState<{
    id: string;
    accessKey: string;
    secretKey: string;
  } | null>(null);
  /** 正在切换状态的行，各自转圈互不影响。 */
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  /** 定制列：草稿在点「确定」前生效，取消即丢弃。 */
  const [colOpen, setColOpen] = useState(false);
  const [colVisibility, setColVisibility] = useState<Record<ColKey, boolean>>({
    ...DEFAULT_COL_VISIBILITY,
  });
  const [colDraft, setColDraft] = useState<Record<ColKey, boolean>>({ ...DEFAULT_COL_VISIBILITY });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['access-keys'] });

  const handleCreate = async () => {
    let values: { name: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setCreating(true);
    try {
      const result = await createAccessKey(values.name.trim());
      setCreated({
        id: result.key.id,
        accessKey: result.key.access_key,
        secretKey: result.secret_key,
      });
      setCreateOpen(false);
      form.resetFields();
      message.success('AccessKey 创建成功');
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建密钥失败');
    } finally {
      setCreating(false);
    }
  };

  const toggleEnabled = async (row: AccessKey, next: boolean) => {
    setToggling(prev => new Set(prev).add(row.id));
    try {
      await setAccessKeyEnabled(row.id, next);
      message.success(next ? '密钥已启用' : '密钥已禁用');
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setToggling(prev => {
        const done = new Set(prev);
        done.delete(row.id);
        return done;
      });
    }
  };

  const remove = async (row: AccessKey) => {
    try {
      await deleteAccessKey(row.id);
      message.success('密钥已删除');
      // 行被删掉后对应的 SecretValue 随之卸载，明文只存在那个组件的内存里。
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const columns = useMemo<TableColumnsType<AccessKey>>(() => {
    const cols: TableColumnsType<AccessKey> = [
      {
        title: 'AccessKey',
        dataIndex: 'access_key',
        key: 'access_key',
        width: RESOURCE_ID_COLUMN_WIDTH,
        render: (value: string) => (
          <Space size={6}>
            <span className={styles.akId} title={value}>
              {value}
            </span>
            <CopyButton value={value} ariaLabel="复制 AccessKey" />
          </Space>
        ),
      },
    ];

    if (colVisibility.name) {
      cols.push({
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        render: (value: string) => <Typography.Text>{value || '-'}</Typography.Text>,
      });
    }

    if (colVisibility.secretKey) {
      cols.push({
        title: 'SecretKey',
        key: 'secret_key',
        render: (_, row) => (
          <SecretValue
            label="SecretKey"
            load={() => revealAccessKey(row.id)}
            // 刚创建出来的那一行默认展示明文，与创建成功弹窗保持一致。
            initialPlaintext={created?.id === row.id ? created.secretKey : undefined}
            unavailableHint="服务端无法还原这把密钥的明文（当前部署未配置加密密钥）。它仍然有效；如需可查看的明文，请新建一对凭据。"
          />
        ),
      });
    }

    if (colVisibility.enabled) {
      cols.push({
        title: '状态',
        dataIndex: 'enabled',
        key: 'enabled',
        render: (enabled: boolean) => (
          <Space size={6}>
            <span className={enabled ? styles.dotGreen : styles.dotGray} />
            <span className={enabled ? styles.statusOn : styles.statusOff}>
              {enabled ? '已开启' : '已停用'}
            </span>
          </Space>
        ),
      });
    }

    if (colVisibility.createdAt) {
      cols.push({
        title: '创建时间',
        dataIndex: 'created_at',
        key: 'created_at',
        render: (value: string) => <span className={styles.timeText}>{formatDate(value)}</span>,
      });
    }

    if (colVisibility.lastUsedAt) {
      cols.push({
        title: '最近访问时间',
        dataIndex: 'last_used_at',
        key: 'last_used_at',
        render: (value?: string) => (
          <span className={styles.timeText}>{value ? formatDate(value) : '-'}</span>
        ),
      });
    }

    cols.push({
      title: '操作',
      key: 'actions',
      ...RESOURCE_ACTION_COLUMN,
      render: (_, row) => (
        <Space size={4}>
          {/* 禁用是安全动作，要确认；启用是无害的恢复，直接执行。 */}
          {row.enabled ? (
            <Popconfirm
              title="确定禁用该密钥？"
              description="禁用后该密钥将无法继续用于程序化访问，可随时重新启用。"
              okText="确定"
              cancelText="取消"
              onConfirm={() => void toggleEnabled(row, false)}
            >
              <Button
                type="link"
                size="small"
                className={styles.actionLink}
                loading={toggling.has(row.id)}
              >
                禁用
              </Button>
            </Popconfirm>
          ) : (
            <Button
              type="link"
              size="small"
              className={styles.actionLink}
              loading={toggling.has(row.id)}
              onClick={() => void toggleEnabled(row, true)}
            >
              启用
            </Button>
          )}
          {/* 删除不可逆，收进「更多」；确认用模态——菜单项里塞不进 Popconfirm。 */}
          <MoreActions
            items={[{ key: 'delete', label: '删除', danger: true }]}
            onClick={({ key }) => {
              if (key !== 'delete') return;
              modal.confirm({
                title: '确定删除该密钥？',
                content: '删除后无法恢复，使用该密钥的接口调用将立即失败。',
                okText: '确定',
                okButtonProps: { danger: true },
                cancelText: '取消',
                onOk: () => remove(row),
              });
            }}
          />
        </Space>
      ),
    });

    return cols;
    // `visible` / `revealed` / `revealing` / `toggling` / `colVisibility` 都是渲染输入；
    // 回调本身每次渲染重建，但列定义必须跟着这些状态变，否则点眼睛不会重画。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created, toggling, colVisibility]);

  const createButton = (
    <Button type="primary" disabled={atLimit} onClick={() => setCreateOpen(true)}>
      创建 AccessKey
    </Button>
  );

  const allChecked = ALL_COLS.every(col => colDraft[col]);
  const someChecked = ALL_COLS.some(col => colDraft[col]);

  return (
    <>
      <div className={styles.body}>
        <Alert
          type="info"
          showIcon
          title={<span style={{ fontWeight: 600 }}>AKSK 使用提示：</span>}
          description={
            <ul className={styles.heroList}>
              <li>您的 API 密钥代表您的账号身份和所拥有的权限，请妥善保管。</li>
              <li>
                列表不返回 SecretKey 明文；点「查看」时才向服务端取一次，刷新页面后会重新隐藏。
              </li>
              <li>若服务端提示「不可查看」，说明当前部署没有配置加密密钥，但该凭据仍然有效。</li>
            </ul>
          }
        />

        <Card
          title={
            <Space size={6}>
              <span className={styles.cardTitle}>Access Key</span>
              <Tooltip
                title={limit > 0 ? `当前最多可创建 ${limit} 对凭据` : '凭据数量由服务端配额决定'}
              >
                <QuestionCircleOutlined className={styles.helpIcon} />
              </Tooltip>
            </Space>
          }
          extra={
            <Space size={8}>
              <Tooltip title="刷新">
                <Button
                  icon={<ReloadOutlined />}
                  size="small"
                  aria-label="刷新"
                  loading={query.isFetching}
                  onClick={() => void query.refetch()}
                />
              </Tooltip>
              <Tooltip title="定制列">
                <Button
                  icon={<SettingOutlined />}
                  size="small"
                  aria-label="定制列"
                  onClick={() => {
                    setColDraft({ ...colVisibility });
                    setColOpen(true);
                  }}
                />
              </Tooltip>
              {atLimit ? (
                <Tooltip title={`已达到 ${limit} 对上限，请先删除不再使用的凭据`}>
                  <span>{createButton}</span>
                </Tooltip>
              ) : (
                createButton
              )}
            </Space>
          }
          styles={{ body: { padding: 0 } }}
        >
          {query.isError && (
            <Alert
              type="error"
              showIcon
              className={styles.cardAlert}
              title="密钥列表加载失败"
              description={query.error instanceof Error ? query.error.message : undefined}
            />
          )}

          <Table<AccessKey>
            className={styles.table}
            rowKey="id"
            size="middle"
            loading={query.isLoading}
            columns={columns}
            dataSource={keys}
            pagination={false}
            // 中间列按内容、整表铺满卡片；操作列贴右缘并吸附。
            {...RESOURCE_TABLE_LAYOUT}
            locale={{
              emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无密钥" />,
            }}
          />

          <div className={styles.keyQuota}>
            {limit > 0 ? `已使用 ${keys.length} / ${limit} 对凭据` : `共 ${keys.length} 对凭据`}
          </div>
        </Card>
      </div>

      <Modal
        title="创建 AccessKey"
        open={createOpen}
        okText="生成密钥"
        cancelText="取消"
        confirmLoading={creating}
        width={440}
        onOk={() => void handleCreate()}
        onCancel={() => {
          setCreateOpen(false);
          form.resetFields();
        }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }} requiredMark={false}>
          <Form.Item
            name="name"
            label="密钥名称"
            rules={[
              { required: true, message: '请输入密钥名称' },
              { max: 32, message: '名称最多 32 个字符' },
            ]}
          >
            <Input placeholder="例如：本地开发环境" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="定制列"
        open={colOpen}
        width={520}
        okText="确定"
        cancelText="取消"
        onOk={() => {
          setColVisibility({ ...colDraft });
          setColOpen(false);
        }}
        onCancel={() => setColOpen(false)}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Button onClick={() => setColDraft({ ...DEFAULT_COL_VISIBILITY })}>恢复默认</Button>
            <Space>
              <CancelBtn />
              <OkBtn />
            </Space>
          </Space>
        )}
      >
        <div style={{ padding: '12px 0' }}>
          <Checkbox
            checked={allChecked}
            indeterminate={!allChecked && someChecked}
            onChange={e => {
              const next = e.target.checked;
              setColDraft(
                Object.fromEntries(ALL_COLS.map(col => [col, next])) as Record<ColKey, boolean>
              );
            }}
            style={{ marginBottom: 12 }}
          >
            全选
          </Checkbox>
          <div className={styles.colCustomBox}>
            {/* AccessKey 是标识本身，始终显示。 */}
            <div className={styles.colCustomItem}>
              <Checkbox checked disabled>
                AccessKey
              </Checkbox>
            </div>
            {ALL_COLS.map(col => (
              <div key={col} className={styles.colCustomItem}>
                <Checkbox
                  checked={colDraft[col]}
                  onChange={e => setColDraft(prev => ({ ...prev, [col]: e.target.checked }))}
                >
                  {COL_LABELS[col]}
                </Checkbox>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        title="AccessKey 创建成功"
        open={created !== null}
        onCancel={() => setCreated(null)}
        footer={
          <Button type="primary" onClick={() => setCreated(null)}>
            我已保存
          </Button>
        }
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="SecretKey 只在这里完整显示"
          description="关闭后仍可在列表里点「查看」再次取回；但请现在就把两段值保存到安全的地方。"
        />
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Typography.Text type="secondary">AccessKey</Typography.Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Typography.Text code copyable={false}>
                {created?.accessKey}
              </Typography.Text>
              <CopyButton value={created?.accessKey} ariaLabel="复制 AccessKey" />
            </div>
          </div>
          <div>
            <Typography.Text type="secondary">SecretKey</Typography.Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Typography.Text code copyable={false}>
                {created?.secretKey}
              </Typography.Text>
              <CopyButton value={created?.secretKey} ariaLabel="复制 SecretKey" />
            </div>
          </div>
        </Space>
      </Modal>
    </>
  );
}

export default AccessKeyPanel;
