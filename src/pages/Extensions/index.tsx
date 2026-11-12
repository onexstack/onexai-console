import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Input,
  Popconfirm,
  Result,
  Space,
  Tabs,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createExtension,
  deleteExtension,
  listExtensionKinds,
  listExtensions,
  updateExtension,
  type ExtensionKind,
  type ExtensionObject,
} from '@/api/extensions';
import PageLayout from '@/components/PageLayout';
import { decodeClaims } from '@/auth/claims';
import { useSessionToken } from '@/auth/tokenStore';
import {
  EllipsisText,
  RESOURCE_ACTION_COLUMN,
  RESOURCE_ID_COLUMN_WIDTH,
  RESOURCE_TABLE_LAYOUT,
  ResizableDrawer,
  ResponsiveTable,
} from '@/ui';

/**
 * 控制面扩展对象。
 *
 * 这一页管理的是平台运行所依赖的「准入与聚合」配置：谁能在写入时被外部服务拦截
 * 或改写（准入 Webhook）、哪些 CEL 规则在进程内生效、外部 API Server 挂在哪个
 * 组版本下。它们由 `oai-declserver` 直接以 Kubernetes 原生 API 提供，本页只做
 * 读、改、删与新建——策略本身的语义由 API Server 与准入插件执行。
 *
 * # 为什么是 JSON 编辑器
 *
 * 这些对象的字段来自四个上游 API 组，且每一版都可能新增字段。用结构化表单意味着
 * 控制台要跟着上游改，并且会**悄悄丢掉**它不认识的字段；直接编辑 API Server 存储
 * 的 JSON，则页面永远与服务端一致。列表页负责看清，抽屉负责改准。
 */
/** ExtensionRow is an object plus the row key the table needs. */
type ExtensionRow = ExtensionObject & { rowKey: string };

export default function ExtensionsPage() {
  const token = useSessionToken();
  const claims = useMemo(() => decodeClaims(token), [token]);
  const queryClient = useQueryClient();

  const [activeResource, setActiveResource] = useState<string>();
  const [editing, setEditing] = useState<{ kind: ExtensionKind; draft: string; name?: string }>();
  const [saving, setSaving] = useState(false);

  const kinds = useQuery({ queryKey: ['extension-kinds'], queryFn: listExtensionKinds });
  const current =
    kinds.data?.find(kind => kind.resource === activeResource) ?? kinds.data?.[0] ?? undefined;

  const objects = useQuery({
    queryKey: ['extensions', current?.resource],
    // `enabled` below is the guard: the query only runs once a kind is selected.
    queryFn: () => listExtensions(current?.resource ?? ''),
    enabled: !!current,
  });

  if (!claims?.isAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <Result
          status="403"
          title="需要管理员权限"
          subTitle="扩展对象决定哪些请求会被拦截或改写，只对管理员开放。"
        />
      </div>
    );
  }

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['extensions', current?.resource] });
  };

  const openCreate = () => {
    if (!current) return;
    setEditing({ kind: current, draft: templateFor(current) });
  };

  const openEdit = (item: ExtensionObject) => {
    if (!current) return;
    setEditing({
      kind: current,
      name: item.metadata?.name,
      draft: JSON.stringify(item, null, 2),
    });
  };

  const save = async () => {
    if (!editing) return;
    let body: ExtensionObject;
    try {
      body = JSON.parse(editing.draft) as ExtensionObject;
    } catch (err) {
      void message.error(`JSON 解析失败：${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    setSaving(true);
    try {
      if (editing.name) {
        await updateExtension(editing.kind.resource, editing.name, body);
        void message.success('已保存');
      } else {
        await createExtension(editing.kind.resource, body);
        void message.success('已创建');
      }
      setEditing(undefined);
      refresh();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: ExtensionObject) => {
    if (!current) return;
    const name = item.metadata?.name;
    if (!name) return;
    try {
      await deleteExtension(current.resource, name);
      void message.success(`已删除 ${name}`);
      refresh();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  // 表格行的 rowKey 用显式字段：ResponsiveTable 的移动端卡片模式只认字符串 /
  // 数字字段，函数形式的 rowKey 在那里会退化成行下标。
  const rows: ExtensionRow[] = (objects.data ?? []).map(item => ({
    ...item,
    rowKey: item.metadata?.name ?? '',
  }));

  const columns = [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      width: RESOURCE_ID_COLUMN_WIDTH,
      render: (_: unknown, row: ExtensionRow) => (
        <EllipsisText maxWidth={RESOURCE_ID_COLUMN_WIDTH - 48}>
          {row.metadata?.name ?? ''}
        </EllipsisText>
      ),
    },
    {
      title: '摘要',
      key: 'summary',
      render: (_: unknown, row: ExtensionRow) => summarize(current, row),
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'createdAt',
      width: 200,
      render: (value: unknown) =>
        typeof value === 'string' ? new Date(value).toLocaleString('zh-CN') : '—',
    },
    {
      title: '操作',
      key: 'actions',
      ...RESOURCE_ACTION_COLUMN,
      render: (_: unknown, row: ExtensionRow) => (
        <Space size={4}>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm
            title="删除后立即生效"
            description={`${row.metadata?.name ?? ''} 会从控制面移除，依赖它的请求将不再被处理。`}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => remove(row)}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PageLayout title="扩展对象">
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="这些对象由控制面的 Kubernetes API 直接提供"
          description={
            <span>
              准入 Webhook、CEL 准入策略与聚合 API 注册都跑在 <code>oai-declserver</code> 上，
              与 Agent、Chat 共用同一个控制面。改动立即生效，不需要重启任何服务。
            </span>
          }
        />

        {kinds.isError && (
          <Alert
            type="error"
            showIcon
            message="无法读取扩展对象类型"
            description={kinds.error instanceof Error ? kinds.error.message : '请求失败'}
          />
        )}

        <Card size="small">
          <Tabs
            activeKey={current?.resource}
            onChange={setActiveResource}
            items={(kinds.data ?? []).map(kind => ({
              key: kind.resource,
              label: kind.displayName,
              children: (
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Typography.Text type="secondary">{kind.description}</Typography.Text>
                    <Space>
                      <Button icon={<ReloadOutlined />} onClick={refresh} loading={objects.isFetching}>
                        刷新
                      </Button>
                      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                        新建
                      </Button>
                    </Space>
                  </Space>

                  {objects.isError ? (
                    <Alert
                      type="error"
                      showIcon
                      message="读取对象失败"
                      description={
                        objects.error instanceof Error ? objects.error.message : '请求失败'
                      }
                    />
                  ) : (
                    <ResponsiveTable<ExtensionRow>
                      rowKey="rowKey"
                      size="middle"
                      loading={objects.isLoading}
                      columns={columns}
                      dataSource={rows}
                      {...RESOURCE_TABLE_LAYOUT}
                      pagination={false}
                      emptyText={`还没有 ${kind.displayName}`}
                    />
                  )}
                </Space>
              ),
            }))}
          />
        </Card>
      </Space>

      <ResizableDrawer
        open={!!editing}
        onClose={() => setEditing(undefined)}
        title={editing?.name ? `编辑 ${editing.name}` : `新建 ${editing?.kind.displayName ?? ''}`}
        defaultWidth={720}
        storageKey="extensions-editor"
        destroyOnHidden
        footer={
          <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
            <Button onClick={() => setEditing(undefined)}>取消</Button>
            <Button type="primary" loading={saving} onClick={save}>
              保存
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            {editing
              ? `apiVersion: ${editing.kind.group}/${editing.kind.version} · kind: ${editing.kind.kind}`
              : ''}
          </Typography.Text>
          <Input.TextArea
            value={editing?.draft ?? ''}
            onChange={event =>
              setEditing(prev => (prev ? { ...prev, draft: event.target.value } : prev))
            }
            autoSize={{ minRows: 20, maxRows: 40 }}
            spellCheck={false}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
          />
        </Space>
      </ResizableDrawer>
    </PageLayout>
  );
}

/** summarize renders the one line that tells these objects apart in a list. */
function summarize(kind: ExtensionKind | undefined, row: ExtensionObject): string {
  if (!kind) return '—';
  const spec = (row['spec'] ?? {}) as Record<string, unknown>;

  switch (kind.resource) {
    case 'validatingwebhookconfigurations':
    case 'mutatingwebhookconfigurations': {
      const hooks = Array.isArray(row['webhooks']) ? (row['webhooks'] as unknown[]) : [];
      return `${hooks.length} 个回调`;
    }
    case 'validatingadmissionpolicies':
    case 'mutatingadmissionpolicies': {
      const rules = Array.isArray(spec['validations'])
        ? (spec['validations'] as unknown[])
        : Array.isArray(spec['mutations'])
          ? (spec['mutations'] as unknown[])
          : [];
      const failure = typeof spec['failurePolicy'] === 'string' ? spec['failurePolicy'] : '';
      return `${rules.length} 条规则${failure ? ` · 失败策略 ${failure}` : ''}`;
    }
    case 'validatingadmissionpolicybindings':
    case 'mutatingadmissionpolicybindings':
      return typeof spec['policyName'] === 'string' ? `绑定 ${spec['policyName']}` : '—';
    case 'apiservices': {
      const group = typeof spec['group'] === 'string' ? spec['group'] : '';
      const version = typeof spec['version'] === 'string' ? spec['version'] : '';
      const service = spec['service'] as Record<string, unknown> | undefined;
      if (service && typeof service['name'] === 'string') {
        return `${group}/${version} → Service ${String(service['namespace'])}/${service['name']}`;
      }
      return `${group}/${version}`;
    }
    default:
      return '—';
  }
}

/**
 * templateFor is the starting point a new object of each kind needs.
 *
 * These are the minimum shapes the API server accepts: a webhook needs a
 * sideEffects/admissionReviewVersions pair, a policy needs match constraints
 * and at least one validation, a binding needs the policy it binds, and an
 * APIService needs both priorities. Anything richer is the administrator's.
 */
function templateFor(kind: ExtensionKind): string {
  const meta = { name: '' };
  const apiVersion = `${kind.group}/${kind.version}`;

  switch (kind.resource) {
    case 'validatingwebhookconfigurations':
    case 'mutatingwebhookconfigurations':
      return JSON.stringify(
        {
          apiVersion,
          kind: kind.kind,
          metadata: meta,
          webhooks: [
            {
              name: 'example.onexai.io',
              admissionReviewVersions: ['v1'],
              sideEffects: 'None',
              failurePolicy: 'Fail',
              clientConfig: { url: 'https://example.invalid/validate' },
              rules: [
                {
                  apiGroups: ['agent.onexai.io'],
                  apiVersions: ['v1alpha1'],
                  operations: ['CREATE', 'UPDATE'],
                  resources: ['agents'],
                },
              ],
            },
          ],
        },
        null,
        2,
      );
    case 'validatingadmissionpolicies':
      return JSON.stringify(
        {
          apiVersion,
          kind: kind.kind,
          metadata: meta,
          spec: {
            failurePolicy: 'Fail',
            matchConstraints: {
              resourceRules: [
                {
                  apiGroups: ['agent.onexai.io'],
                  apiVersions: ['v1alpha1'],
                  operations: ['CREATE', 'UPDATE'],
                  resources: ['agents'],
                },
              ],
            },
            validations: [{ expression: 'object.spec.name != "forbidden"', message: 'not allowed' }],
          },
        },
        null,
        2,
      );
    case 'validatingadmissionpolicybindings':
      return JSON.stringify(
        { apiVersion, kind: kind.kind, metadata: meta, spec: { policyName: '', validationActions: ['Deny'] } },
        null,
        2,
      );
    case 'mutatingadmissionpolicies':
      return JSON.stringify(
        {
          apiVersion,
          kind: kind.kind,
          metadata: meta,
          spec: {
            matchConstraints: {
              resourceRules: [
                {
                  apiGroups: ['agent.onexai.io'],
                  apiVersions: ['v1alpha1'],
                  operations: ['CREATE'],
                  resources: ['agents'],
                },
              ],
            },
            mutations: [{ patchType: 'ApplyConfiguration', applyConfiguration: { expression: 'object' } }],
          },
        },
        null,
        2,
      );
    case 'mutatingadmissionpolicybindings':
      return JSON.stringify(
        { apiVersion, kind: kind.kind, metadata: meta, spec: { policyName: '' } },
        null,
        2,
      );
    case 'apiservices':
      return JSON.stringify(
        {
          apiVersion,
          kind: kind.kind,
          metadata: meta,
          spec: {
            group: 'example.onexai.io',
            version: 'v1',
            groupPriorityMinimum: 1000,
            versionPriority: 10,
            insecureSkipTLSVerify: true,
            service: { name: 'example', namespace: 'default', port: 443 },
          },
        },
        null,
        2,
      );
    default:
      return JSON.stringify({ apiVersion, kind: kind.kind, metadata: meta }, null, 2);
  }
}
